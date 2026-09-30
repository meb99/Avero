# Dateiformate

Alle Parser liegen in `crates/avero-formats/src/formats`. Erkannt wird zuerst am Inhalt, dann an der Endung, in derselben Reihenfolge wie OpenBoardView. Koordinaten werden nach mil (1/1000 Zoll) umgerechnet, die Y-Achse zeigt nach oben.

| Format | Endung | Erkennung | Einheit | Hinweise |
| --- | --- | --- | --- | --- |
| Test_Link BRD | `.brd` | `str_length:` + `var_data:`, oder verschleierter Kopf `23 E2 63 28` | mil | Verschleierung: jedes Byte um 2 Bit nach links rotiert und invertiert. Pins ohne Netznamen bekommen das Netz des Nagels mit gleicher Prüfnummer (Lenovo). |
| BRD2 | `.brd` | `BRDOUT:` + `NETS:` | mil | Unterseite ist in Y gespiegelt gespeichert. Bauteile tragen ihre Box und den Index des ersten Pins. |
| Honhan BDV | `.bdv` | verschleierter Kopf `dd:1.3?,r?-=bb` | Zoll | Pro Byte `Schlüssel − Wert`, Schlüssel beginnt bei 160 und steigt pro CRLF-Zeile, von 286 zurück auf 159. Inhalt = ASC-Abschnitte. |
| ASUS ASC | `.asc` | Endung | Zoll | Drei Dateien im selben Ordner: `format.asc`, `pins.asc`, `nails.asc` (Groß-/Kleinschreibung egal). Kopfzeilen werden an der Zeilenform erkannt statt an einer festen Anzahl. |
| BoardViewer BVR | `.bvr` | `BVRAW_FORMAT_1` | Zoll | Abschnitte `<<Layout>>`, `<<Pin>>`, `<<Nail>>`. |
| BoardViewer BVR3 | `.bvr` | `BVRAW_FORMAT_3` | mil | Zeilenweise `SCHLÜSSEL Wert`. Pin-Radius und Bauteilumriss werden übernommen. |
| GenCAD 1.4 | `.cad`, `.gcd` | `GENCAD` + `$HEADER` | laut `UNITS` | Liest Umriss, Pads/Padstacks (Größe, Seite, Bohrung), Shapes (Pins, Umriss), Komponenten, Devices (Wert), Signale, Vias. |
| Panel-CAD | `.cad` | `###Panel Added` + `C_PIN` | Zoll | Kein Umriss in der Datei, er wird aus den Pins erzeugt. |
| IBM CST | `.cst` | Endung | unbekannt | Binär. Nur Bauteile, Netze und Pins; Umriss wird aus den Pins erzeugt. |
| XinZhiZao PCB | `.pcb` | Kopf `XZZPCB`, auch XOR-verschleiert (Schlüsselbyte bei `0x10`, bis zur Marke `v6v6555v6v6`) | 1/10000 mil | Blöcke: Bögen (1) und Linien (5) auf Lage 28 = Umriss, Bauteile (7) DES-verschlüsselt, Testpads (9). Der DES-Schlüssel wird vom Nutzer eingetragen und über ein Paritätsmuster auf Tippfehler geprüft. Alle Bauteile liegen auf „Oben", wie bei OpenBoardView. |

## Noch nicht unterstützt

Diese Formate werden erkannt und mit einer klaren Meldung abgelehnt:

| Format | Stand |
| --- | --- |
| ASUS `.fz` | verschlüsselt, Schlüssel nötig. Geplant für 0.4. |
| Teboview `.tvw` | Geplant für 0.4. |
| Cadence Allegro | Erkennung über Offset `0xF8`. Keine Pläne. |
| PDF | Kein Board, sondern ein Schaltplan: wird im Schaltplan-Viewer geöffnet. |

## Was der Builder ergänzt

Die meisten Formate speichern nur Pin-Mittelpunkte. `builder.rs` ergänzt deshalb:

- **Pin-Radius** aus dem Abstand zum nächsten Pin desselben Bauteils (40 %, 2 bis 40 mil).
- **Bauteilumriss:** Box entlang der Achse bei 2 Pins, sonst die engste von zwei Drehlagen.
- **Netzart** aus dem Namen: `GND`, `PGND`, `VSS` → Masse; `PP3V3_S5`, `+3VALW`, `VCC_*`, `1V8` → Versorgung; `NC`, leer → nicht verbunden.
- **Board-Umriss** aus losen Segmenten (Endpunkte werden verkettet) oder, wenn keiner da ist, aus den Pins.
