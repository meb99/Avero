# Roadmap

Ziel: ein Mac-Werkzeug, das Boardview, Schaltplan und Werkstattwissen zusammenbringt, auf dem Niveau von FlexBV und XinZhiZao.

## 0.1 Boardview-Kern ✅

- Rust-Parser für BRD, BRD2, BDV, ASC, BVR, BVR3, GenCAD, Panel-CAD, CST mit Tests
- einheitliches Board-Modell: Netze, Netzarten (Signal, Versorgung, Masse, nicht verbunden), geschätzte Pin-Größen, Bauteilumrisse
- WebGL-2-Renderer, Oberseite/Unterseite, Drehen, Netz-Hervorhebung über beide Seiten
- Suche (Bauteil, Netz, `Bauteil.Pin`), Detailpanel, Bauteil- und Netzlisten
- Mac-App: Ampeln in der Toolbar, Finder-Integration, Drag & Drop, Hell/Dunkel, Deutsch/Englisch

## 0.2 Schaltplan

- PDF-Viewer (pdf.js) neben dem Board oder auf einem zweiten Monitor
- Textindex der Schaltplanseiten
- Querverweise in beide Richtungen: Bauteil oder Netz im Board anklicken → Seite im Schaltplan springt hin und markiert es; Bezeichner im Schaltplan anklicken → Board zeigt es
- Schaltplan automatisch neben der Boardview-Datei finden (gleicher Ordner, gleiche Boardnummer)

## 0.3 Werkstatt

- **Bibliothek:** Ordner einlesen, nach Gerät und Boardnummer sortieren (`iPhone 13 Pro → 820-02100`), Boardview, Schaltplan und Fotos automatisch verknüpfen, Volltextsuche über alles
- **Messwerte pro Netz:** Diodenmodus, Spannung, Widerstand speichern; beim nächsten gleichen Board werden die Normwerte angezeigt, Abweichungen farbig markiert
- **Notizen und Fehlerfälle** pro Board, mit Verlauf der Reparaturen
- **Fotos** des echten Boards über die Boardview legen (zwei Punkte ausrichten)
- Export/Import der eigenen Messwerte und Notizen

## 0.4 Weitere Formate

- XinZhiZao `.pcb` (DES-verschlüsselte Bauteilblöcke, Schlüssel lokal hinterlegt), inklusive der darin enthaltenen Diodenwerte
- ASUS `.fz` (Schlüssel lokal hinterlegt)
- Teboview `.tvw`
- echte Pad-Formen und Bauteil-Silkscreen, wo das Format sie enthält

## 0.5 Profi-Funktionen

- mehrere Boards in Tabs, zwei Boards vergleichen
- Netze über 0-Ω-Widerstände, Spulen und Sicherungen hinweg verfolgen (virtuelle Netze), z. B. `PPBUS → PP3V8`
- Luftlinien (Ratsnest) zwischen den Pins eines Netzes
- Befehlspalette (⌘K), frei belegbare Tastenkürzel
- Board als Bild exportieren, drucken
- Mac-Menüleiste mit allen Befehlen
