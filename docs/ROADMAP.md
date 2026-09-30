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

## Offen

Diese Punkte brauchen **echte Beispieldateien**, die Avero nicht mitliefern darf. Wer eigene Dateien hat, kann sie lokal mit `avero-inspect` prüfen und die Ergebnisse (nicht die Dateien) als Issue melden:

- Diodenwerte aus XZZ-Dateien (Abschnitt nach `v6v6555v6v6`) als Referenzwerte übernehmen – Aufbau des Abschnitts ist nicht öffentlich beschrieben
- XZZ-Bauteile auf der Unterseite erkennen (bisher alles „Oben", wie bei OpenBoardView)
- Teboview `.tvw` – keine freie Formatbeschreibung
- `.fz`-Dateien mit echtem Schlüssel gegenprüfen (bisher mit synthetischen Dateien nach OpenBoardView getestet)

Weitere Ideen:
- zwei Boards nebeneinander vergleichen
- Pin-Nummern im Schaltplan dem Pin im Board zuordnen
- echte Pad-Formen und Bauteil-Silkscreen, wo das Format sie enthält
- frei belegbare Tastenkürzel
