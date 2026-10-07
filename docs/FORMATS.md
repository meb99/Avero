# Dateiformate

Alle Parser liegen in `crates/avero-formats/src/formats`. Erkannt wird zuerst am Inhalt, dann an der Endung, in derselben Reihenfolge wie OpenBoardView. Koordinaten werden nach mil (1/1000 Zoll) umgerechnet, die Y-Achse zeigt nach oben.

**Prüfstand:** „Echt geprüft“ heißt: mit echten Dateien aus der Praxis abgeglichen (Bauteil-/Pinzahl, Pin-Netz-Zuordnung, Unterseite). „Nur nachgebaut geprüft“ heißt: Der Leser folgt der Formatbeschreibung und ist mit selbst erzeugten Dateien getestet, aber noch nicht mit echten Exporten – Abweichungen einzelner Programmversionen sind dort möglich. Wer eine echte Datei eines solchen Formats hat, hilft mit einem Testlauf.

| Format | Prüfstand |
| --- | --- |
| GenCAD (Lenovo LA-G132P), BRD2/GR (Dell), BVR3 (Switch), XZZ (Switch OLED, direkt und über die GenCAD-Umwandlung) | echt geprüft |
| Test_Link BRD (PS5) | mit echten Dateien geöffnet, ohne Referenzabgleich |
| BDV, ASC, BVR, Panel-CAD, CST, FZ, CAE | nachgebaut geprüft nach der Vorlage von OpenBoardView |
| KiCad, EAGLE, Altium PCB ASCII, Allegro ASCII / Fabmaster | nur nachgebaut geprüft |
| Allegro binär, Altium binär, HyperLynx, EasyEDA Pro V2, ODB++-Bestückung | an öffentlichen echten Exporten geprüft; begrenzter Umfang, siehe Erweiterungen |
| Teboview TVW, ATE BV | strukturierter Leser; noch keine echte Beispieldatei abgenommen |

| Format | Endung | Erkennung | Einheit | Hinweise |
| --- | --- | --- | --- | --- |
| Test_Link BRD | `.brd` | `str_length:` + `var_data:`, oder verschleierter Kopf `23 E2 63 28` | mil | Verschleierung: jedes Byte um 2 Bit nach links rotiert und invertiert. Pins ohne Netznamen bekommen das Netz des Nagels mit gleicher Prüfnummer (Lenovo). |
| BRD2 / GR | `.brd`, `.gr` | `BRDOUT:` + `NETS:` | mil | Unterseite ist in Y gespiegelt gespeichert. Bauteile tragen ihre Box und den Index des ersten Pins. Manche Exporte (z. B. Dell `.gr`) setzen eine Gruppennummer vor Netz- und Bauteilnamen (`3%GND`); sie wird entfernt, damit gleiche Netze zusammenfallen. |
| Honhan BDV | `.bdv` | verschleierter Kopf `dd:1.3?,r?-=bb` | Zoll | Pro Byte `Schlüssel − Wert`, Schlüssel beginnt bei 160 und steigt pro CRLF-Zeile, von 286 zurück auf 159. Inhalt = ASC-Abschnitte. |
| ASUS ASC | `.asc` | Endung | Zoll | Drei Dateien im selben Ordner: `format.asc`, `pins.asc`, `nails.asc` (Groß-/Kleinschreibung egal). Kopfzeilen werden an der Zeilenform erkannt statt an einer festen Anzahl. |
| BoardViewer BVR | `.bvr` | `BVRAW_FORMAT_1` | Zoll | Abschnitte `<<Layout>>`, `<<Pin>>`, `<<Nail>>`. |
| BoardViewer BVR3 | `.bvr` | `BVRAW_FORMAT_3` | mil | Zeilenweise `SCHLÜSSEL Wert`. Pin-Radius und Bauteilumriss werden übernommen. `PIN_ORIGIN` ist je nach Programm relativ zum Bauteil oder absolut; Avero erkennt das pro Datei daran, welche Lesart die Pins näher an ihr Bauteil legt. |
| GenCAD 1.4 | `.cad`, `.gcd` | `GENCAD` + `$HEADER` | laut `UNITS` | Liest Umriss, Pads/Padstacks (Größe, Seite, Bohrung), Shapes (Pins, Umriss), Komponenten, Devices (Wert), Signale, Vias und Leiterbahnen (`$ROUTES`, Breite aus `$TRACKS`, Lage oben/innen/unten). Dateien, die `UNITS INCH` angeben, aber in Mil schreiben (XZZ-Konverter), werden erkannt; Bauteile ohne Form werden aus dem Kupfer geschätzt (Typ, Seite, Größe, Pads; Pins mit Netz, wo Leiterbahn oder Via auf dem Pad enden), siehe `crates/avero-formats/src/infer.rs`. |
| Panel-CAD | `.cad` | `###Panel Added` + `C_PIN` | Zoll | Kein Umriss in der Datei, er wird aus den Pins erzeugt. |
| IBM CST | `.cst` | Endung | unbekannt | Binär. Nur Bauteile, Netze und Pins; Umriss wird aus den Pins erzeugt. |
| XinZhiZao PCB | `.pcb` | Kopf `XZZPCB`, auch XOR-verschleiert (Schlüsselbyte bei `0x10`, bis zur Marke `v6v6555v6v6`) | 1/10000 mil | Blöcke: Bögen (1) und Linien (5) auf Lage 28 = Umriss, Bauteile (7) DES-verschlüsselt, Testpads (9). Der DES-Schlüssel wird vom Nutzer eingetragen und über ein Paritätsmuster auf Tippfehler geprüft. Alle Bauteile liegen auf „Oben", wie bei OpenBoardView. Ohne Schlüssel öffnet Avero die Datei trotzdem mit allem Unverschlüsselten: Umriss, Netze und Testpads mit Namen; die Bauteile werden als verschlüsselt gemeldet. Nach der Marke steht Klartext mit Messwerten: Listen `===<Titel>` (GBK), je Zeile `=<Wert>=<Bauteil>(<Pin>)`. Gelesen wird die Liste `阻值` (Diodenwerte in mV oder `OL`) sowie eindeutig bezeichnete Spannungs- und Widerstandslisten mit belegter Einheit, an einer echten Datei geprüft (Switch OLED: 1252 Werte, alle auf Bauteil und Pin des Boards gefunden); die Werte gehen pinbezogen mit Herkunft „XZZ 阻值“ in die Referenz, eigene Werte bleiben. Unbekannte oder mehrdeutige Listen und Einträge ohne eindeutig passenden Pin werden nicht geraten, sondern im Importbericht genannt. |
| KiCad | `.kicad_pcb` | beginnt mit `(kicad_pcb` | mm, Y nach unten | S-Ausdrücke (KiCad 5 bis heute): Netze, Footprints (`footprint`/`module`) mit Referenz, Wert, Seite, Lage und Drehung, Pads (Nummer, Größe, SMD oder durchkontaktiert, Netz), Vias, Umriss aus den `Edge.Cuts`-Grafiken (Linien, Bögen, Rechtecke, Kreise, Polygone). Bohrlöcher ohne Nummer und Netz sind keine Pins. |
| Allegro ASCII / Fabmaster | `.txt`, `.fab`, beliebig | `A!`-Kopfzeile mit `REFDES`, `NET_NAME` oder `CLASS!SUBCLASS` und `S!`-Zeilen | laut `J!`-Zeile (mils, mm, inch, micron) | Tabellen werden an ihren Spalten erkannt: Bauteile (`REFDES`, `SYM_X/Y`, `SYM_MIRROR` = Unterseite, Typ und Wert), Pins (`PIN_X/Y`, `PIN_NUMBER`, `PIN_NAME`, `NET_NAME`, `PAD_STACK_NAME`, `PIN_ROTATION`), Netzliste ohne Koordinaten, Vias und Testpunkte (`VIA_X/Y`, `TEST_POINT`), Padstacks (`PAD_NAME`, `LAYER`, `PADSHAPE1`, `PADWIDTH`, `PADHGHT`; ein Stack auf beiden Außenlagen = durchkontaktiert), Grafik (`BOARD GEOMETRY`/`OUTLINE` mit Linien, Bögen und Rechtecken als Umriss, `ETCH` mit Netz als Leiterbahnen). |
| Altium PCB ASCII | `.PcbDoc` | enthält `KIND=Protel_Advanced_PCB`, keine OLE-Datei | mil, Y nach oben | Zeilen aus `\|SCHLÜSSEL=WERT`-Feldern: Netze, Bauteile (Bezeichner, Seite, Bibliotheksteil, Footprint), Pads mit absoluter Lage, Größe, Form und Drehung, freie Pads mit Netz als Testpunkte, Vias, Kupferbahnen und -bögen als Leiterbahnen, Umriss aus der Board-Form (`VX0`/`VY0` …) oder der Keep-out-Lage. Werte tragen ihre Einheit (`mil`, `mm`). Die binäre `.PcbDoc` (OLE) nutzt den neuen Binary-Reader; siehe [Erweiterungen](FORMATS_AND_EDITOR.md). |
| EAGLE / Fusion 360 | `.brd` | XML mit `<eagle` | mm | Pakete der eingebetteten Bibliotheken (SMD- und THT-Pads), platzierte Elemente (Drehung `R90`, gespiegelt = Unterseite `MR90`), Signale (Pad → Netz, Vias), Umriss von Lage 20 (Dimension) samt Bögen. Binäre EAGLE-Dateien vor Version 6 werden nicht gelesen. |
| ASUS FZ | `.fz` | Endung; unverschlüsselt, wenn ab Byte 4 ein zlib-Kopf (`78 9C`/`78 DA`) steht | mil (oder mm bei `UNIT:millimeters`) | Verschlüsselt mit einer Stromchiffre aus RC6-Runden (jedes Byte XOR dem niedrigsten Byte einer RC6-Verschlüsselung der 16 vorherigen Chiffratbytes). Der Schlüssel (44 Wörter) wird vom Nutzer eingetragen und per Wortparität geprüft. Danach zwei zlib-Ströme: Inhalt (`A!`-Blöcke `REFDES`, `NET_NAME`, `TESTVIA`, Felder mit `!` getrennt, auch Dezimalkommas) und Stückliste (Tab-getrennt, liefert die Bauteilwerte). Kein Umriss in der Datei, er wird aus den Pins erzeugt. Nachgebaut nach OpenBoardView, geprüft mit synthetischen Testdateien. |

## Erweiterungen ab 0.9.30

Binäres Allegro, TVW, binäres Altium, HyperLynx, EasyEDA-Pro-V2 und ODB++-Bestückung sind eingebaut; ATE BV ist experimentell. Hinzu kommen der lokale Boardeditor und die räumliche PDF-Suche. Verbindlicher Umfang, getestete Varianten und nicht dargestellte Daten: [Formate und Boardeditor](FORMATS_AND_EDITOR.md).

## Noch nicht unterstützt

Diese Formate werden erkannt und mit einer klaren Meldung abgelehnt:

| Format | Stand |
| --- | --- |
| Proprietäre Varianten F2B, BVRE, ASR, A3P, FAZ | Noch kein verifizierter Decoder. Bereits bekannte Inhaltsformate werden unabhängig von der Endung geprüft. |
| Allegro außerhalb 16.0–17.4, EasyEDA V3/epro2 | Noch nicht freigegeben. |
| PDF | Kein Board, sondern ein Schaltplan: wird im Schaltplan-Viewer geöffnet. |

## Was der Builder ergänzt

Die meisten Formate speichern nur Pin-Mittelpunkte. `builder.rs` ergänzt deshalb:

- **Pin-Radius** aus dem Abstand zum nächsten Pin desselben Bauteils (40 %, 2 bis 40 mil).
- **Bauteilumriss:** Box entlang der Achse bei 2 Pins, sonst die engste von zwei Drehlagen.
- **Netzart** aus dem Namen: `GND`, `PGND`, `VSS` → Masse; `PP3V3_S5`, `+3VALW`, `VCC_*`, `1V8` → Versorgung; `NC`, leer → nicht verbunden.
- **Board-Umriss** aus losen Segmenten (Endpunkte werden verkettet) oder, wenn keiner da ist, aus den Pins.

## XZZ → GenCAD in der Bibliothek

Seit 0.8.0 bietet die Bibliothek eine native Konvertierung von XZZ-`.pcb` nach
GenCAD 1.4 (`UNITS THOU`). Sie liest DES- oder unverschlüsselte Bauteilblöcke,
kurze und lange Pin-Footer, Padgrößen, Rotation, Netzzuordnungen, Kontur,
Leiterbahnen, Vias und Layer. Ungültige Bauteildaten werden nicht als leere CAD
exportiert. Ein kompatibler Standardschlüssel ist für diesen Konvertierungsweg
enthalten; der direkte XZZ-Reader nutzt weiterhin den Schlüssel aus den
Einstellungen. Ein eingetragener Schlüssel überschreibt auch beim Konvertieren
den Standard. Alle Ausgaben werden vor dem Speichern mit Averos GenCAD-Reader
geprüft. Vorhandene Dateien werden nicht überschrieben und gleiche Ausgaben
werden erkannt. Tests im Repository verwenden ausschließlich synthetische Daten.

Die erweiterte Ausgabe erhält zusätzlich Bauteilkonturen und Texte,
Via-Bohrungen und Layer-Spannen, Bildverweise und Zusatzabschnitte. Reguläre
GenCAD-Header-Attribute enthalten die komprimierte Originaldatei und einen
Konvertierungsbericht. Avero stellt pinbezogene XZZ-Messwerte daraus auch beim
erneuten Öffnen wieder her. Undokumentierte Inhalte werden erhalten und
ausgewiesen, aber nicht semantisch geraten. Siehe [XZZ-Konvertierung](XZZ_CONVERSION.md).
