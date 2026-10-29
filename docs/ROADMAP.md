# Roadmap

Ziel: ein Mac-Werkzeug, das Boardview, Schaltplan und Werkstattwissen zusammenbringt, auf dem Niveau von FlexBV und XinZhiZao.

## 0.1 Boardview-Kern ✅

- Rust-Parser für BRD, BRD2, BDV, ASC, BVR, BVR3, GenCAD, Panel-CAD, CST mit Tests
- einheitliches Board-Modell: Netze, Netzarten (Signal, Versorgung, Masse, nicht verbunden), geschätzte Pin-Größen, Bauteilumrisse
- WebGL-2-Renderer, Oberseite/Unterseite, Drehen, Netz-Hervorhebung über beide Seiten
- Suche (Bauteil, Netz, `Bauteil.Pin`), Detailpanel, Bauteil- und Netzlisten
- Mac-App: Ampeln in der Toolbar, Finder-Integration, Drag & Drop, Hell/Dunkel, Deutsch/Englisch

## 0.2 Schaltplan ✅

- PDF-Viewer (pdf.js) neben dem Board, verschiebbarer Trenner, scharfes Nachrendern beim Zoomen
- Wortindex aller Seiten im Hintergrund, auch für gedrehten Text
- Querverweise in beide Richtungen: Bauteil oder Netz im Board → Fundstellen im Schaltplan (mit `[` / `]` durchblättern); Bezeichner im Schaltplan anklicken → Board zeigt es
- Schaltplan automatisch neben der Boardview-Datei finden (gleicher Name oder gleiche Boardnummer)
- Seitennavigation und PDF-Lesezeichen, Demo-Schaltplan zum Demo-Board

Nachgereicht in 0.5:
- Schaltplan in einem eigenen Fenster (zweiter Monitor), verbunden mit dem Board ✅
- Suche im Schaltplan nach beliebigem Text, auch nach Wortteilen ✅

## 0.3 Werkstatt ✅

- **Bibliothek:** Ordner einlesen, Boardviews und Schaltpläne nach Boardnummer und Ordner gruppieren, Suche über Boardnummer, Gerät und Dateinamen, Board und Schaltplan mit einem Klick öffnen, nicht lesbare Formate ausgegraut
- **Messwerte pro Netz:** Diodenmodus, Spannung, Widerstand; Referenz (gutes Board) und Reparaturfälle getrennt; Abweichungen über der Toleranz rot, auch als Punkte auf dem Board
- **Notizen** pro Board und pro Fall
- Export/Import der Messwerte und Notizen als JSON, gespeichert pro Board im App-Ordner

Nachgereicht in 0.5:
- **Fotos** des echten Boards über die Boardview legen (zwei Punkte ausrichten) ✅
- Volltextsuche über alle Schaltpläne der Bibliothek ✅

## 0.4 XZZ und eigene Bibliothek ✅

- XinZhiZao `.pcb` lesen (XOR-Kopf, DES-verschlüsselte Bauteile, Testpads mit Namen, Umriss aus Linien und Bögen); Schlüssel in den Einstellungen, Paritätsprüfung, klare Meldungen bei fehlendem oder falschem Schlüssel
- Eigene Avero-Bibliothek: Import von Dateien, Ordnern und ZIP-Archiven per Drag & Drop oder Dialog, Sortierung nach Boardnummer oder Geräteordner, Duplikaterkennung, „Im Finder zeigen"

Nachgereicht in 0.5:
- ASUS `.fz` lesen, verschlüsselt (Schlüssel in den Einstellungen) und unverschlüsselt ✅
- 7z- und RAR-Archive importieren (über das in macOS eingebaute `bsdtar`) ✅

## 0.5 Mac-App und Profi-Funktionen ✅

- DMG als veröffentlichtes Release (Universal), Ad-hoc-signiert; Hinweis auf neue Versionen
- Mac-Menüleiste mit allen Befehlen und „Zuletzt geöffnet"
- Befehlspalette (⌘K) mit Befehlen, Bauteilen, Netzen und Pins
- Verbindungslinien (Ratsnest) zwischen den Pins eines Netzes
- Netze über 0-Ω-Widerstände, Spulen, Ferrite, Sicherungen und Jumper hinweg verfolgen („Weiter über")
- Ansicht als PNG exportieren (Drucken geht über das exportierte Bild in Vorschau)
- mehrere Boards in Tabs, jeder mit eigenem Schaltplan, eigener Auswahl und Ansicht
- zwei Boards nebeneinander vergleichen, Auswahl nach Namen gespiegelt

Erledigt in 0.9.20: Pin-Sprung in den Schaltplan, echte Pad-Formen aus GenCAD, frei belegbare Tastenkürzel, Texterkennung für gescannte Schaltpläne, XZZ über den Konverter vollständig öffnen.

Erledigt bis 0.9.48: XZZ-Diodenwerte (`阻值`) als Referenz, binäres Allegro 16.0–17.4, binäres Altium, Teboview-TVW-Leser, HyperLynx, EasyEDA Pro V2, ODB++-Bestückung, Boardeditor, räumliche PDF-Suche, Windows-Version. Einzelheiten: [Bestandsaufnahme](BESTANDSAUFNAHME.md).

## Stand Oktober 2026 (Branch `local/nexusbv-parity`, Version noch 0.9.48)

### Erledigt

- Trace-Regeln im `tracedef.txt`-Format mit Import und Export (Einstellungen › Trace-Regeln)
- Unterseite umdrehen: links-rechts, oben-unten oder gar nicht, in der Einzelansicht und bei beiden Seiten zugleich
- Bauteile ohne Informationen abdunkeln
- Schaltplansuche: ganzes Wort in Anführungszeichen, reguläre Ausdrücke als `/…/`
- Vitest läuft unabhängig vom Betriebssystem des Rechners
- CI auch für `local/**`-Branches: Rust-Prüfungen für lokale Windows-Sitzungen, in denen Smart App Control Cargo blockiert
- [Bestandsaufnahme](BESTANDSAUFNAHME.md) mit Formattiefe und Funktionsmatrix

### Offen, ohne Beispieldateien machbar

- Zoom-Ring um den Mauszeiger beim Zoomen (FlexBV)
- Vollständigen Signalweg und Parallelzweige auf dem Board hervorheben (bisher Liste mit „Zeigen“)
- Zuletzt geöffnete Dateien anheften
- Themes und Tastenbelegung als Datei importieren und exportieren
- Suchergebnisse im Schaltplan fixieren
- Websuche nach Teilenummer, nur auf Klick
- Bauteil-, Pin- und Netzname über das Kontextmenü kopieren (per ⌘C schon vorhanden)
- Release 0.9.49 vorbereiten: Version an fünf Stellen, README „Neu in 0.9.49“, `docs/VERGLEICH.md`

### Blockiert: echte Beispieldateien fehlen

Avero darf Herstellerdateien nicht mitliefern. Wer eigene Dateien hat, kann sie lokal mit `avero-inspect` prüfen und die Ergebnisse (nicht die Dateien) als Issue melden.

- Neue Leser: A3P, F2B, FAZ, BVRE, ASR, CON, Fabmaster-FIL, Mentor Neutral, TopTest- und Landrex-BRD, NBV, Allegro ab 18, EasyEDA V3
- XZZ-Bauteile auf der Unterseite erkennen (bisher alles „Oben“, wie bei OpenBoardView)
- Teboview TVW und ATE BV an echten Dateien abnehmen; Bauteil-Silkscreen, wo das Format ihn enthält
- `.fz`-Dateien mit echtem Schlüssel gegenprüfen (bisher synthetische Dateien nach OpenBoardView)
- Boardviews, die nur als PDF vorliegen (Bauteilnamen und Pads als Zeichnung)
- Multimeter-Profile über Owon XDM hinaus mit echten Geräten prüfen (Antwort auf `*IDN?` und `MEAS?`)

### Blockiert: Werkzeuge

- Browser-Tests (`tools/browser-tests/run.sh`) brauchen Cargo für das Demo-Board: lokal blockiert Smart App Control, in der CI ist kein Job dafür eingerichtet
