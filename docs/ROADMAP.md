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

Offen aus 0.2:
- Schaltplan in einem eigenen Fenster (zweiter Monitor)
- Suche im Schaltplan nach beliebigem Text, nicht nur nach Board-Namen
- Pin-Nummern im Schaltplan dem Pin im Board zuordnen (nicht nur dem Bauteil)

## 0.3 Werkstatt ✅

- **Bibliothek:** Ordner einlesen, Boardviews und Schaltpläne nach Boardnummer und Ordner gruppieren, Suche über Boardnummer, Gerät und Dateinamen, Board und Schaltplan mit einem Klick öffnen, nicht lesbare Formate ausgegraut
- **Messwerte pro Netz:** Diodenmodus, Spannung, Widerstand; Referenz (gutes Board) und Reparaturfälle getrennt; Abweichungen über der Toleranz rot, auch als Punkte auf dem Board
- **Notizen** pro Board und pro Fall
- Export/Import der Messwerte und Notizen als JSON, gespeichert pro Board im App-Ordner

Offen aus 0.3:
- **Fotos** des echten Boards über die Boardview legen (zwei Punkte ausrichten)
- Volltextsuche über alle Schaltpläne der Bibliothek
- Diodenwerte aus XZZ-Dateien als Referenz übernehmen (kommt mit dem XZZ-Format)

## 0.4 XZZ und eigene Bibliothek ✅

- XinZhiZao `.pcb` lesen (XOR-Kopf, DES-verschlüsselte Bauteile, Testpads mit Namen, Umriss aus Linien und Bögen); Schlüssel in den Einstellungen, Paritätsprüfung, klare Meldungen bei fehlendem oder falschem Schlüssel
- Eigene Avero-Bibliothek: Import von Dateien, Ordnern und ZIP-Archiven per Drag & Drop oder Dialog, Sortierung nach Boardnummer oder Geräteordner, Duplikaterkennung, „Im Finder zeigen"

Offen:
- Diodenwerte aus XZZ-Dateien (Abschnitt nach `v6v6555v6v6`) als Referenzwerte übernehmen
- ASUS `.fz` (Schlüssel lokal hinterlegt), Teboview `.tvw`
- XZZ-Bauteile auf der Unterseite erkennen (bisher alles „Oben")
- echte Pad-Formen und Bauteil-Silkscreen, wo das Format sie enthält
- RAR-/7z-Archive importieren

## 0.5 Profi-Funktionen

- mehrere Boards in Tabs, zwei Boards vergleichen
- Netze über 0-Ω-Widerstände, Spulen und Sicherungen hinweg verfolgen (virtuelle Netze), z. B. `PPBUS → PP3V8`
- Luftlinien (Ratsnest) zwischen den Pins eines Netzes
- Befehlspalette (⌘K), frei belegbare Tastenkürzel
- Board als Bild exportieren, drucken
- Mac-Menüleiste mit allen Befehlen
