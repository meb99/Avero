# Vergleich mit FlexBV und NexusBV

Stand Oktober 2026. Grundlage sind öffentliche Quellen: das
[FlexBV-5-Handbuch](https://pldaniels.com/flexbv5/manual/), die
[NexusBV-Seite](https://nexusbv.net/) mit Changelog (v0.9) und der offene Quellcode von
[OpenBoardView](https://github.com/OpenBoardView/OpenBoardView) (MIT, Stand `cc76e69`).
Ideen und Bedienkonzepte übernimmt Avero, Code nicht. FlexBV und NexusBV sind bisher nicht
zerlegt worden (siehe „Programmanalyse“ unten).

## Was FlexBV einfach macht

- **Das Board hat das Fenster.** Board und Schaltplan teilen sich die Breite 60 : 40; dazu eine
  schmale Infoleiste. Keine Reiter in der Leiste, keine Meldungen beim Öffnen.
- **Mechanik ist weg.** Teile, deren Pins alle an Masse oder an nichts hängen und die größer als
  1 Zoll sind, blendet FlexBV von Anfang an aus.
- **Rechtsklick sucht im Schaltplan:** auf dem Bauteilkörper das Bauteil, auf einem Pin das Netz.
- **Mittelklick** dreht auf die andere Seite, `<` / `>` drehen das Board.
- **Text nach Größe:** Pinnummer ab 9 px Pad-Radius, Messwerte ab 15 px, Netzname ab 30 px.
- **Tooltip nach 0,7 s** über Bauteil und Pin, beim Pin mit erwarteten Messwerten (OBData).

## Übernommen in Avero

| FlexBV / NexusBV | Avero |
| --- | --- |
| Symbolleiste aus Material Symbols, Menüs Darstellung · Suchen · Board · Werkstatt | ab 0.9.45 |
| Board in Oliv, Pin 1 rot, Namen orange, Netz lila, Werte als weiße Schildchen, Mittellinien | ab 0.9.45 |
| Infoleiste mit aufklappbaren Abschnitten (Verlauf, Netz, Bauteile mit View · Z · Schematic · Prefix) | ab 0.9.45 |
| Statuszeile mit Auswahl und Mausposition in Zoll und mm | ab 0.9.45 |
| Suchmaske „Search for Component / Network“ mit Teilwort, Anfang, ganzem Namen, zwei Feldern | ab 0.9.46 (⌘F) |
| Tooltip als Tabelle mit Messwerten | ab 0.9.46 |
| Board 60 % neben dem Schaltplan | ab 0.9.44 (vorher 50 %) |
| Infoleiste stört beim Öffnen nicht | ab 0.9.44: Seitenleiste eingeklappt bis zur ersten Auswahl |
| Mechanische Teile ausgeblendet | ab 0.9.44: Abschirmungen und Rahmen ohne Körper, Pads bleiben; abschaltbar |
| Rechtsklick → Schaltplan | ab 0.9.44 |
| Mittelklick → andere Seite | ab 0.9.44 |
| Constellation (Verbindungslinien mit wenig Ästen) | Verbindungslinien als minimaler Spannbaum |
| Butterfly / Dual View | beide Seiten nebeneinander, getrennt oder gekoppelt |
| Netz über 0-Ω, Spulen, Sicherungen verfolgen (Mycelium), Stufen 1–3, Raute auf Verbindungsteilen, Farben je Netz | ab 0.9.47 |
| Multisearch (gemeinsame Netze mehrerer Bauteile) | Mehrfachauswahl mit gemeinsamen Netzen |
| Part Find in einer PDF-Sammlung | Inhaltssuche der Bibliothek, auch mit Bereich |
| OBData, Multimeter, Minimap, Text nach Größe, Tooltips | vorhanden |
| NexusBV: Reiter, Notizen, Lesezeichen, Board-Editor, Tasten- und Farbeditor, MCP, dunkle PDF-Seiten | vorhanden |
| Netweb (Linien vom gewählten Pin zu seinem Netz; OpenBoardView, FlexBV) | ab 0.9.48 |
| Widerstände bis 1 Ω als Verbindungsteile (FlexBV) | ab 0.9.48 |
| Suche mit Wert und Typ (OpenBoardView „Including details“) | ab 0.9.48 |
| FlexBV und NexusBV laufen auf Windows | Avero ab 0.9.48 auch |

## OpenBoardView

Aus dem Quellcode (`src/openboardview/FileFormats`, `BoardView.cpp`, `Searcher.cpp`):

| Format in OpenBoardView | Avero |
| --- | --- |
| ASC, BDV, BRD, BRD2, BVR, BVR3, CAD (Panel), CAE, CST, FZ, GenCAD, XZZ `.pcb` | vorhanden |
| `ADFile` (Altium ASCII, `\|KIND=Protel_Advanced_PCB`) | vorhanden (`altium.rs`), dazu Altium binär |
| Allegro (`BRDAllegroFile.h`) | vorhanden, eigener Leser für 16.0–17.4 |

Alle Formate von OpenBoardView liest Avero also schon. Bei den Funktionen fehlten Netweb und
die Suche in den Bauteildetails; beide sind ab 0.9.48 da. Alles andere aus den Menüs
(Annotationen, Hintergrundbild, Bauteil- und Netzliste, Infoleiste, Drehen, Spiegeln,
Mausposition, Zoom aufs Netz, Groß-/Kleinschreibung, ganzes Wort) hat Avero in eigener Form.

## Noch offen

Ohne Beispieldateien (Formate brauchen nach den Regeln des Projekts echte Dateien):

- **Allegro binär ab 18** (NexusBV liest 16–25, Avero 16.0–17.4).
- **F2B, A3P, FAZ, BVRE, ASR** – kein verifizierter Decoder.
- **Teboview TVW** – Leser vorhanden, aber an keiner echten Datei abgenommen; damit auch kein
  Silkscreen (FlexBV zeigt ihn nur bei TVW).

Ohne Dateien machbar, als nächster Schritt:

- **Zoom-Ring** um den Mauszeiger beim Zoomen.

## Programmanalyse von FlexBV und NexusBV

Bisher nicht gemacht. Eine Analyse der Programme (etwa mit Ghidra und einem
Reverse-Engineering-MCP wie REA/ReVa) läuft dort, wo Programme und Werkzeuge liegen, also in
einer Claude-Sitzung auf dem eigenen Rechner. Eine Cloud-Sitzung erreicht weder den Rechner noch
dessen MCP-Server. Dafür braucht es:

- die installierten Programmordner (FlexBV 5 und NexusBV, mit `.exe`, `.dll` und Ressourcen)
  und eine gültige eigene Lizenz;
- echte Beispieldateien der Formate, die Avero noch fehlen (F2B, A3P, FAZ, BVRE, ASR, Allegro
  ab 18, TVW). Nur damit lässt sich ein Leser bauen und abnehmen.

Grenzen: Kein fremder Code wird übernommen, Lizenzprüfungen und Schlüssel werden nicht umgangen
oder ausgelesen (für XZZ gilt die feste Regel des Projekts). Ziel einer Analyse sind
Dateiformate (Interoperabilität) und Funktionsumfang; gebaut wird eigenständig.
