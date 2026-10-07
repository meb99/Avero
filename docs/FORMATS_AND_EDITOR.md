# Lokale Importe, Boardeditor und PDF-Suche (0.9.30)

Alle hier beschriebenen Funktionen arbeiten auf diesem Rechner. Die Importer
benötigen keinen Server, kein installiertes CAD-Programm und keine Konvertierung
im Terminal. Eine Dateiendung allein ist keine Zusage, dass jede Herstellervariante
gelesen werden kann. Unbekannte Varianten werden abgelehnt oder ausdrücklich
im Importbericht genannt.

## Die acht Erweiterungen

| Punkt | Eingebaut | Grenzen |
| --- | --- | --- |
| 1. Binäres Allegro | Lokaler, mitgelieferter Leser für 16.0–17.4: platzierte Bauteile, benannte Pins, Netzzuordnungen, Kupferlagen, Padgrößen, Vias, Linien und segmentierte Bögen; erkannte Platinenkanten. | Keine vollständige CAD-Interpretation. Kupferfüllungen, Zeichnungstexte, Bestückungspolygone, Bauteilwerte und Via-Bohrungen/Lagenspannen werden noch nicht dekodiert. Bauteilkörper werden aus den Pins ergänzt; pinlose Bauteile erhalten eine Positionsmarkierung. Neuere Allegro-Versionen sind nicht freigegeben. |
| 2. Teboview TVW | Strukturierter Binärleser für die EagleView-Datensatzvariante: Ober-/Unterseite, Bauteile, Padformen, Pins über Pad-Handles, Netze, Lagen, Leiterbahnen und segmentierte Bögen, Bohrpunkte. | Andere Datensatzfamilien werden abgelehnt. Füllflächen und nachgelagerte Fertigungs-/Footprint-Metadaten werden nicht gezeichnet. Noch keine Abnahme mit einer bereitgestellten echten TVW-Datei; Tests prüfen einen strukturierten Zwei-Lagen-Datensatz und beschädigte Daten. |
| 3. Binäres Altium PcbDoc | OLE/CFB-Dokumente mit Board6, Nets6, Components6, Pads6, Vias6, Tracks6 und Arcs6: Bauteile, reale Padpositionen/-größen/-rotationen, Pin- und Netzzuordnung, Vias mit Bohrung/Spanne, Leiterbahnen, Bögen und Kontur. | Polygonfüllungen, Regions und Zeichnungstexte sind nicht vollständig dargestellt. Unbekannte Primitive oder widersprüchliche Record-Zähler führen zu einer Fehlermeldung. |
| 4. Weitere Spezialformate | Experimenteller nativer ATE-BV-Leser für Jet-Datenbanken mit Layout-/Pin-/Nail-Tabellen; kein Access/ODBC nötig. Bekannte Inhaltsformate werden unabhängig von ihrer Endung erkannt. | Der BV-Tabellenleser ist noch nicht mit einer echten ATE-Datei abgenommen. Für proprietäres F2B, verschlüsseltes BVRE, ASR, A3P und FAZ gibt es weiterhin keinen verifizierten Decoder. Das Umbenennen einer Datei entschlüsselt sie nicht. |
| 5. ODB++, HyperLynx, EasyEDA Pro | HyperLynx 2.x ASCII mit expliziten Einheiten, Pads, Netzen, Leiterbahnen, Vias und Kontur; ODB++-Bestückungsimport aus Ordner, ZIP oder TAR/GZIP; EasyEDA-Pro-V2-Projekte mit eingebetteten Footprints, Platzierungen, Pad-Netzen, Leiterbahnen und Vias. Projekte mit mehreren Boards bieten eine Auswahl. | ODB++ braucht EDA-Daten und Komponentenplatzierung; Paket-/Padkonturen werden teilweise ergänzt, Kupferpads, Füllungen, Bohrspannen und Panel-Wiederholungen sind noch nicht vollständig dekodiert. Gekrümmte ODB++-Profile werden klar abgelehnt. HyperLynx-Füllpolygone fehlen. EasyEDA unterstützt die geprüfte V2/DOCTYPE-1.8-Variante, nicht V3/epro2; fehlende Footprints werden nicht erfunden. Nicht dargestellte Primitive werden gemeldet. |
| 6. XZZ-Messwerte | Diodenwerte, ausdrücklich bezeichnete Spannungs- und Widerstandslisten; V/mV und Ohm-Präfixe werden normalisiert, OL bleibt OL. Nur eindeutig vorhandene Bauteil-/Pinpaare werden zugeordnet. Herkunft und vorhandene Bedingungen bleiben beim Speichern erhalten. | Fehlende Einheiten/Bedingungen werden nicht geraten. Die bekannte Liste 阻值 behält ihre belegte Diodenwert-Konvention in mV. Unbekannte Zusatzabschnitte bleiben im XZZ-Konvertierungsarchiv erhalten. GenCAD enthält normalerweise keine Soll-Messwerte; Avero erzeugt solche Werte nicht aus Netznamen. |
| 7. Boardeditor | Neues Board oder Arbeitskopie eines geöffneten Boards; Bauteile/Pads hinzufügen, auswählen, umbenennen, verschieben und löschen; Netz, Seite, Padgröße/-form/-winkel und Bauteilwert bearbeiten; 30 Schritte Rückgängig/Wiederholen. | Ein Geometrieeditor, kein elektrischer Schaltungsentwurf mit DRC oder Autorouter. Leiterbahnen und vorhandene Konturen bleiben erhalten, haben aber noch keine eigenen Zeichenwerkzeuge. Gespeichert wird eine neue `.averoboard`-Datei. Eigene Reparaturfälle und Notizen folgen der bestehenden Boardkennung. Gleiche Kennungen können dieselbe Referenz nutzen; bei umbenannten Pins werden eigene Notizen nicht automatisch umgeschrieben. Für den gezielten Datentransfer ist das bestehende Board-Paket vorgesehen. |
| 8. Räumliche PDF-Suche | Bis zu zwölf exakte Begriffe innerhalb eines einstellbaren Abstands auf derselben PDF-Seite; bibliotheksweite lokale Suche, gespeicherte OCR-Koordinaten eingeschlossen; ein Klick öffnet die konkrete Seite und Fundregion. | Es müssen Positionsindizes vorhanden sein. Alte Indizes lassen sich über „Index aufbauen“ ergänzen. OCR muss vorher im Viewer ausgeführt werden. Maximal 200 Ergebnisse und begrenzter Suchaufwand; ein Hinweis kennzeichnet unvollständige Ergebnisse. |

## Im Programm verwenden

**Dateien:** Über den normalen Öffnen-Dialog, Finder oder Drag-and-drop öffnen.
Ein ODB++-Ordner lässt sich über die Befehlspalette (`⌘K`) mit
„Projektordner öffnen…“ auswählen. Beim Bibliotheksimport werden erkannte
Projektordner als vollständiges lokales Archiv übernommen. EasyEDA-Projekte
bitte als vollständige `.epro`-Datei importieren; ein einzelnes `.epcb` kann
benötigte Footprints außerhalb der Datei haben. Auch beim Öffnen eines Projekts
mit mehreren Boards bleibt die Platinenwahl erhalten; eine weitere Platine
desselben Projekts lässt sich in einem weiteren Tab öffnen.

**Editor:** „Board bearbeiten…“ in der Werkzeugleiste oder Befehlspalette öffnet
die Arbeitskopie. „Neues Board…“ beginnt leer. Ein Bauteil/Pad auswählen,
„Position setzen“ betätigen und die Zielstelle anklicken, oder Koordinaten im
Formular eingeben. Alle Koordinaten und Padgrößen sind in mil. „Speichern und
öffnen“ bietet einen Dateidialog; „In Bibliothek übernehmen“ ist vorausgewählt.
Die Originaldatei wird dadurch nicht umgeschrieben.

**Suche:** Bibliothek → Textsuche → „Mehrere Begriffe nahe beieinander“.
Beispielsweise `1uF 16V 0201` eingeben, Abstand in PDF-Punkten einstellen und
fehlende Indizes aufbauen. Die Suche fordert alle Begriffe auf derselben Seite
und prüft den Abstand zwischen jedem Paar. `16V` trifft nicht `116V`.

## Technische Prüfung

- Binäres Altium: echtes öffentliches `simple.PcbDoc` aus pluots/altium,
  60 × 40 mm, drei Bauteile, vier Pins und zwei Vias; zusätzliche Record-Tests.
- Binäres Allegro: öffentliche Boards aus rifaasyari/1-16_RF_PWR_DIV und
  makerdiary/Smart-Plug; 277/648 bzw. 112/361 Bauteile/Pins gelesen.
- HyperLynx: echte `hairpinfilter.HYP` aus koendv/hyp2mat, sieben Bauteile und
  sieben Pins; zusätzlicher Test der metrischen Einheiten.
- EasyEDA: offizielles V2-Beispielprojekt; Projektwahl, lokale Footprintauflösung,
  unterseitige Rotation und Netzzuordnung geprüft.
- ODB++: KiCad-9.0.3-Export `blinky.odb.zip` aus hauksbee; fünf Bauteile,
  vierzehn Pins und fünf Netze. Zusätzlich Dateieinheiten, absolute TOP-Positionen,
  FID-Zuordnung, Archivgrenzen und falsche Netzordinalzahlen geprüft.
- Editor: Pinbesitz, Verschieben, Netztabellen, Undo-Daten, große Boards,
  native Speichern/Laden-Rundreise und ungültige Indizes geprüft.
- Messwerte/Suche: getrennte Messarten, Bedingungsänderungen, doppelte Pinbezeichnungen,
  Löschungen/eigene Werte, räumliche Nähe, Seitengrenzen und Tokenverwechslungen geprüft.

Die Original-Beispieldateien bleiben außerhalb des Repositorys. Die Aussagen
über echte Dateien bestätigen diese geprüften Varianten, keine vollständige
Kompatibilität mit allen Hersteller-Versionen.

## Lizenzen

Der TVW-Port basiert auf Pavel Kovalenkos EagleView (MIT); Altium-Feldlayouts
wurden gegen tscircuit/altium (MIT) geprüft. Der separate Allegro-Prozess verwendet
`brd_parser` unter GPL-3.0. Seine vollständigen geänderten Quellen und
Bauanweisungen liegen in `tools/allegro-reader` und `src-tauri/build.rs`; die
Lizenzen werden mit der App ausgeliefert. Einzelheiten stehen in `NOTICE`.
