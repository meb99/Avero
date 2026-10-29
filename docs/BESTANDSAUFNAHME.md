# Bestandsaufnahme

Stand 2026-10-29, Branch `local/nexusbv-parity`. Grundlage sind der Quellcode, die Tests und die Dokumente im
Repository. Eine Funktion gilt nur dann als vorhanden, wenn Code und möglichst ein Test sie belegen. Eine
Dateiendung allein bedeutet keine Unterstützung.

## Ausgangslage

- **Version:** 0.9.48 an allen fünf Stellen (`package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`,
  `Cargo.lock`). Der Branch trägt neue Funktionen, die Version ist noch nicht erhöht.
- **Prüfwege:** Frontend (Typecheck, Vitest, Build) und `cargo fmt` laufen lokal. `cargo clippy`, `cargo test` und
  die App-Builds laufen nur in der GitHub-CI, weil Smart App Control unter Windows die von Cargo gebauten
  Build-Skripte blockiert (os error 4551). Ein Push auf `local/**` startet die CI.
- **Beispieldateien:** Auf dem Arbeitsrechner gibt es keine echten Boardview-Dateien (Suche in Downloads,
  Dokumente, Desktop, OneDrive und D:\). Nach der Projektregel „Neue Formatleser nur mit echten Beispieldateien“
  ist jede neue oder geänderte Formatlogik damit derzeit blockiert.

## Aufbau

| Teil | Inhalt |
| --- | --- |
| `crates/avero-formats` (Rust) | Leser für 24 Formate in `src/formats` (Allegro binär über `src-tauri`), Erkennung in `formats::detect` (Inhalt vor Endung, Reihenfolge wie OpenBoardView). `builder.rs` ergänzt Pin-Radius, Bauteilumriss, Netzart und Board-Umriss. `infer.rs` schätzt Bauteile aus dem Kupfer (GenCAD aus dem XZZ-Konverter). `project.rs` wählt Boards aus Projekten (ODB++, EasyEDA). Werkzeug `avero-inspect <datei> --json`. |
| Datenmodell | `model.rs` und gleichlautend `src/core/types.ts`: `Board` mit `Part`, `Pin` (Lage, Radius, Padform, Netz, Seite), `Net` (Art: Signal, Versorgung, Masse, nicht verbunden), `TestPoint`, `Trace`, `Layer`, Umriss, `Derived` (was abgeleitet ist) und `FileReading` (Messwerte mit Herkunft). Einheit mil, Y nach oben, für alle Formate gleich. |
| `src-tauri` | Datei- und Bibliotheksimport (Ordner, ZIP, 7z, RAR), XZZ-Konvertierung, Notizen, Board-Pakete, Sicherung, Messgerät, MCP, Updater. Binäres Allegro über einen eigenen Prozess (`tools/allegro-reader`, GPL-3.0). |
| Frontend | `src/core` (Boardmodell, Suche, BGA, Jumper, Vergleich, Versorgungsbaum, Signalweg, Trace-Regeln), `src/render` (WebGL 2), `src/schematic` (pdf.js, Wortindex, OCR, Querverweise), `src/workbench` (Messwerte, Fälle, Chronik, Berichte). |
| Tests | Rust: 44 Integrationstests (`tests/formats.rs`, `tests/conversion.rs`), 56 Modultests in `avero-formats`, 57 in `src-tauri`. Frontend: 86 Vitest-Dateien mit 475 Tests. Browser-Tests (Playwright) brauchen Cargo und laufen deshalb weder lokal noch in der CI. |

## Formate und ihre Implementierungstiefe

„Echt geprüft“ heißt: an echten Dateien aus der Praxis abgeglichen. „Nachgebaut“ heißt: nach Formatbeschreibung
oder OpenBoardView geschrieben und mit selbst erzeugten Dateien getestet.

| Format | Erkennung | Prüfstand | Belege |
| --- | --- | --- | --- |
| GenCAD 1.4 | Inhalt `GENCAD` + `$HEADER` | echt geprüft (Lenovo LA-G132P); Umriss, Padstacks, Shapes, Devices, Signale, Vias, Leiterbahnen | `gencad`, `gencad_metric_units`, `gencad_routes_and_misdeclared_units`, `gencad_pad_shapes` |
| BRD2 / GR | Inhalt `BRDOUT:` + `NETS:` | echt geprüft (Dell) | `brd2` |
| BVR3 | Inhalt `BVRAW_FORMAT_3` | echt geprüft (Switch) | `bvr_v3`, `bvr3_with_absolute_pin_origins` |
| XZZ `.pcb` | Inhalt `XZZPCB`, auch XOR | echt geprüft (Switch OLED), Einschränkungen siehe unten | `xzz_plain_and_xored`, `xzz_key_errors`, `xzz_without_key_shows_outline_and_test_pads`, `truncated_xzz_is_an_error_not_a_panic` |
| Test_Link BRD | Inhalt oder verschleierter Kopf | echte Dateien geöffnet, ohne Referenzabgleich | `brd_plain`, `brd_obfuscated_and_crlf` |
| BDV, ASC, BVR, Panel-CAD, CST, FZ, CAE | Inhalt bzw. Endung | nachgebaut (OpenBoardView) | `bdv`, `asc_file_set`, `bvr_v1`, `panel_cad`, `cst`, `fz_plain`, `fz_in_millimeters`, `fz_encrypted`, `cae_is_fz_with_its_own_key` |
| KiCad, EAGLE, Altium PCB ASCII, Allegro ASCII | Inhalt | nachgebaut | `kicad_boards`, `eagle_boards`, `altium_ascii_pcbdoc`, `allegro_ascii_extract` |
| Allegro binär 16.0–17.4, Altium binär, HyperLynx, EasyEDA Pro V2, ODB++-Bestückung | Inhalt bzw. Endung | an öffentlichen echten Exporten geprüft, begrenzter Umfang (keine Füllflächen, teils keine Bohrspannen) | Modultests der Leser, `docs/FORMATS_AND_EDITOR.md` |
| Teboview TVW, ATE BV | Inhalt bzw. Endung | **teilweise:** strukturierter Leser, keine echte Datei abgenommen | Modultests `tvw.rs`, `bv.rs` |
| F2B, BVRE, ASR, A3P, FAZ, unbekannte BV-Variante | Endung | **fehlend:** erkannt und mit klarer Meldung abgelehnt | `formats::detect` |
| Allegro außerhalb 16.0–17.4, EasyEDA V3/epro2 | Inhalt bzw. Endung | **fehlend:** abgelehnt | `FORMATS.md` |
| NBV (NexusBV), CON, Mentor Neutral, TopTest- und Landrex-BRD | – | **fehlend:** nicht erkannt („unbekannt“) | – |
| FIL | nur über den Inhalt | **ungeprüft:** GenCAD- oder Allegro-ASCII-Inhalt wird unabhängig von der Endung gelesen, ein eigener Fabmaster-FATF-Leser fehlt | `formats::detect` |

Robustheit für alle Leser: `errors`, `garbage_never_panics`, `damaged_files_never_panic`,
`truncated_cst_is_an_error_not_a_panic`, `json_shape`.

## XZZ-Unterstützung

- **Direkter Leser** (`formats/xzz.rs`): XOR-Kopf, DES-verschlüsselte Bauteilblöcke mit einem vom Nutzer
  eingetragenen Schlüssel (Paritätsprüfung). Ohne Schlüssel öffnet Avero Umriss, Netze und Testpads und meldet die
  Bauteile als verschlüsselt. Messwertlisten nach der Marke `v6v6555v6v6` (Diodenwerte `阻值`, eindeutig benannte
  Spannungs- und Widerstandslisten) werden pinbezogen mit Herkunft übernommen.
- **Einschränkung:** Alle Bauteile liegen auf „Oben“. Die Unterseite wird noch nicht erkannt; dafür fehlen
  Beispieldateien.
- **Konverter XZZ → GenCAD** (`convert.rs`): erweiterte Ausgabe mit Archiv der Originaldatei und Bericht. Nach
  `CLAUDE.md` gesperrt, er wird nur über seine öffentliche Schnittstelle benutzt.
- XZZ-Schlüssel werden weder ausgeliefert noch offengelegt.

## Funktionsmatrix

| Funktion | Status | Beleg / Lücke |
| --- | --- | --- |
| XZZ-Import | teilweise | Siehe oben: echt geprüft an einem Board, Unterseite fehlt |
| Zusätzliche Formate | teilweise | 24 Formate in `formats::SUPPORTED`; 4 an echten Praxisdateien abgeglichen, 5 an öffentlichen echten Exporten geprüft, der Rest nachgebaut oder nicht abgenommen. Lücken siehe Formattabelle |
| Mehrdateiimport | vorhanden | ASC-Satz aus drei Dateien (`asc_file_set`), ODB++-Ordner und -Archive, EasyEDA-Projekte mit Boardwahl (`project.rs`), Bibliotheksimport von Ordnern und Archiven (`src-tauri/src/import.rs`, 12 Tests) |
| Automatische Formaterkennung | vorhanden | `formats::detect`, Inhalt vor Endung; Tests `detects_xzz_with_xor_header`, `extension_decides_asc_and_pdf`, `errors` |
| Leiterplattenansicht | vorhanden, lokal nur teilweise prüfbar | WebGL-2-Renderer, Ober-/Unterseite, Dual View, Drehen, Unterseite umdrehen; Tests `camera`, `dualView`, `quad`, `grid`. Die Darstellung selbst prüfen nur die Browser-Tests |
| Bauteil- und Pad-Darstellung | vorhanden | Padformen aus GenCAD, KiCad, Altium u. a.; geschätzte Pin-Radien (`builder.rs`); Pin 1 hervorgehoben. **Fehlend:** Silkscreen |
| Netze und Verbindungen | vorhanden | Netzhervorhebung über beide Seiten, Verbindungslinien (Spannbaum), Netweb, Verfolgung über Serienbauteile in drei Stufen, Signalweg mit Trace-Regeln (`trace.ts`, `traceRules.ts`). **Teilweise:** vollständiger Signalweg und Parallelzweige nur als Liste, nicht als Board-Hervorhebung |
| Layer-Verwaltung | teilweise | Leiterbahnlagen einzeln schaltbar (`LayerList.tsx`), Ober-/Unterseite. Keine Lagen für Silkscreen und Füllungen, keine Transparenz |
| Suche und Navigation | vorhanden | Suchmaske (⌘F), Befehlspalette, `Bauteil.Pin`, Suche mit Wert und Typ (`partSearch.test.ts`), Auswahlverlauf (`selectionHistory.test.ts`), Lesezeichen. **Schaltplan:** Teilwort, ganzes Wort in Anführungszeichen, reguläre Ausdrücke `/…/` (`textIndex.test.ts`); Suchergebnisse fixieren fehlt |
| Auswahl und Hervorhebung | vorhanden | Mehrfachauswahl mit gemeinsamen Netzen, Isolation, angeheftete Netze in eigenen Farben, Bauteile ohne Informationen abdunkeln |
| Board- und Bauteilinformationen | vorhanden | Detailpanel, Infoleiste, Tooltips mit Messwerten, Datenherkunft (`Derived`, Importbericht) |
| Zoom, Pan und Rendering | vorhanden | `zoomBy`, `zoomTo`, Pinch, Minimap, Text nach Größe. **Fehlend:** Zoom-Ring um den Mauszeiger |
| Kopieren von Bauteil, Pin, Netz | vorhanden | ⌘C bzw. Strg+C ohne markierten Text kopiert die Auswahl (`selectionText`). Kein eigener Kontextmenüpunkt |
| Fehlerbehandlung | vorhanden | 19 Fehlercodes (`LoadErrorCode`), Importbericht, Tests gegen Abstürze bei beschädigten Dateien |
| Große Dateien | ungeprüft | Größengrenze (`too-large`), virtuelle Listen, Editor-Test mit großem Board. Keine Messung mit echten großen Boards |
| Zuletzt geöffnete Dateien anheften | fehlend | Liste vorhanden, Anheften nicht |
| Themes und Tastenbelegung als Datei austauschen | fehlend | Editoren vorhanden, ohne Datei-Import und -Export |
| Websuche nach Teilenummer | fehlend | – |
| Dual View ohne Spiegelung der Unterseite | vorhanden | „Unterseite umdrehen“ (links-rechts, oben-unten, gar nicht) gilt auch bei beiden Seiten zugleich (`dualView.test.ts`, alle Arten und Drehungen). Darstellung lokal nicht angesehen |

## Analysewerkzeuge

- **GhidraMCP** funktioniert in der lokalen Sitzung (Projekt `Avero-Analysis`, nicht verändernde Aufrufe von
  `ghidra://programs`, `functions.list`, `memory.list_blocks` und `symbols.list`). Ergebnis für Formatfragen:
  - `flexbv.exe`: Die FlexBV-EULA (Abschnitt 3a) verbietet Dekompilieren, Reverse Engineering und Disassemblieren.
    Nicht analysiert.
  - `NexusBV.exe`: reiner Starter, importiert nur `NEXUSBV_CORE.DLL!NexusBV_Run`; enthält keine Format- oder
    Modelllogik. Die Kern-DLL ist nicht im Projekt, GhidraMCP bietet keinen Import, und für NexusBV liegt keine
    Lizenz vor.
  - Avero selbst liegt im Quellcode vor; eine Binäranalyse bringt dort nichts.
- **REA 6.8.0:** Der Server läuft und öffnet Ziele (`open_binary` auf `avero.exe`), aber kein Analyse-Provider ist
  verfügbar (Ghidra nicht eingerichtet, das native Windows-Addon wird von Smart App Control blockiert).
- **Folgerung:** Formatwissen kann derzeit nur aus echten Beispieldateien kommen, nicht aus Programmanalyse.

## Blockiert

| Aufgabe | Grund |
| --- | --- |
| Neue Leser: A3P, F2B, FAZ, CON, Fabmaster-FIL, Mentor Neutral, TopTest-/Landrex-BRD, NBV, Allegro ab 18, BVRE, ASR | keine echten Beispieldateien |
| XZZ-Unterseite, weitere XZZ-Varianten | keine Beispieldateien; der Konverter ist gesperrt |
| Abnahme von TVW und ATE BV | keine Beispieldateien |
| Rust-Prüfungen lokal, Browser-Tests | Smart App Control (bleibt aktiviert); Rust-Prüfungen laufen in der CI |
