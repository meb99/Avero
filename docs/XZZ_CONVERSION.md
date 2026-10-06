# XZZ-Konvertierung und Datenerhaltung

Die Bibliothek verwendet den Rust-Konverter in `crates/avero-formats/src/convert.rs`.
Mehrere Dateien oder ein Ordner lassen sich im Programm auswählen; Dateinamen,
Kategorie und Ablage übernimmt Avero. Es ist kein separates C++-Programm nötig.

## In reguläres GenCAD umgesetzt

- XOR-Dateihülle, DES-Bauteildaten und unverschlüsselte Bauteilblöcke.
- Bauteile, Pinbezeichnungen, Padformen und Größen, Positionen, Drehungen,
  Netzverbindungen und numerische Layer.
- Linien und dokumentierte Bögen des Platinenumrisses, einschließlich großer
  Bögen, Übergängen über 0 Grad und vollständigen Kreisen.
- Bauteilkonturen im lokalen Koordinatensystem der jeweiligen GenCAD-Shape;
  Bauteiltexte in `$COMPONENTS` und globale Beschriftungen in `$BOARD`.
- Kupferlinien und Bögen mit Netz und Breite; Vias mit Außengröße,
  Bohrdurchmesser und Padstack vom ersten bis zum letzten bekannten Kupferlayer.
- UTF-8- und GBK-Text. Namen, die GenCAD nicht direkt schreiben kann, werden
  bereinigt; originale Bauteil- und Pinnamen bleiben über die Zuordnung und
  alle übrigen Originaldaten über die eingebettete Quelle erhalten.

Avero liest Via-Padstacks mit: Blindvias haben ihre tatsächliche Ober- oder
Unterseite, vergrabene Vias ihre Innenlagen und den Hinweis, dass sie keinen
Messkontakt an einer Oberfläche haben. Vergrabene Vias erscheinen bei sichtbarem
Innenkupfer; ohne Leiterbahnen oder bei ausgeschalteten beteiligten Innenlagen
werden sie weder gezeichnet noch mit einem Mausklick als Oberflächenkontakt
ausgewählt. Die vorhandene XZZ-Erkennung zweier nebeneinander gezeichneter
Ansichten wird auch beim erneuten Öffnen dieser CAD-Dateien angewendet. Die
unveränderten GenCAD-Koordinaten bleiben in der Datei erhalten.

## Messwerte und zusätzliche Daten

Pinbezogene Diodenwerte aus `阻值` werden beim erneuten Öffnen der CAD-Datei aus
der eingebetteten Quelle wiederhergestellt. UTF-8/GBK und CR, LF, CRLF werden
gelesen. Der Bericht unterscheidet gelesene, zugeordnete und unlesbare Messzeilen.
Bei doppelten oder fehlenden Originalnamen wird kein Pin geraten. Ein weiterer
Ladevorgang hängt dieselben Werte nicht noch einmal an.

Andere Listen (etwa netzbezogene Spannungen oder `阻值图`), Menüs, Kommentare,
Parameter, Bildverweise und undokumentierte Blöcke bleiben als Metadaten und
Originaldaten erhalten. Sie werden nicht mit erfundenen Einheiten,
Messbedingungen oder Bedeutungen in die Referenzmessungen übernommen.
Layer 34 wird beispielsweise numerisch erhalten: Sein Auftreten allein beweist
keine durchkontaktierte Bohrung oder bestimmte Platinenoberseite.
Die externe Bilddatei zu einem Bildverweis muss separat vorhanden sein.

## Wiederherstellung und Kompatibilität

Die vollständigen ursprünglichen Bytes werden mit Zlib komprimiert und als
Hex-Daten in regulären GenCAD-Header-Attributen der Kategorie `AVERO_XZZ`
gespeichert. Es gibt keinen zusätzlichen, unbekannten GenCAD-Abschnitt.
`VERSION`, `SOURCE_BYTES`, gestückelte `REPORT_HEX`- und `DATA`-Attribute sowie
`END` erlauben die Prüfung und Wiederherstellung. Ein individuell eingetragener
DES-Schlüssel wird nicht als Konfigurationswert exportiert.

In Avero speichert „XZZ-Original speichern…“ die Originaldatei über den
Dateidialog. Die Rust-API bietet außerdem `convert::original_xzz` und
`convert::conversion_report`. Das optionale CLI `xzz-to-gencad` verwendet
denselben Konverter und überschreibt keine vorhandene Datei:

```sh
cargo run -p avero-formats --bin xzz-to-gencad -- input.pcb output.cad
cargo run -p avero-formats --bin xzz-to-gencad -- --restore-source output.cad restored.pcb
```

GenCAD hat keine standardisierte XZZ-Messwert- oder Menüsemantik. Andere Viewer
können die normalen Boarddaten lesen und die Attribute ignorieren; Averos
Wiederherstellung der Messwerte wird dadurch nicht zu einer Funktion anderer
Programme. Speichert ein anderes Programm die CAD-Datei ohne diese Attribute
neu, ist die eingebettete Quelle darin nicht mehr vorhanden.

## Prüfung und Grenzen

Vor dem Speichern werden Bauteil-, Pin- und Viazahlen mit Averos GenCAD-Reader
geprüft. Beschädigte Bauteilblöcke oder ein unpassender Schlüssel brechen die
Konvertierung ab. Beschädigte Archive, falsche Größen, Hex-Daten und Zlib-Daten
werden gemeldet. Die Größe der entpackten Originaldatei ist begrenzt.

Die automatischen Tests enthalten ausschließlich selbst erzeugte Testdaten:
verschlüsselte/klare Bauteile, XOR, beide Pin-Footer, Bauteilkonturen,
Ober-/Unterseite, Via-Layer und Bohrungen, Bögen, Textcodierung,
Messwertzuordnung, Metadaten und bytegenaue Wiederherstellung. Herstellerdateien
werden nicht eingecheckt. Eine vollständige semantische Unterstützung aller
unbekannten XZZ-Versionen lässt sich daraus nicht ableiten; die Erhaltung der
Originalbytes ist davon unabhängig.

Formatgrundlagen: [XZZPCB-ImHex](https://github.com/slimeinacloak/XZZPCB-ImHex),
[XZZPCB-Layer-Viewer](https://github.com/sjohnson1021/XZZPCB-Layer-Viewer),
[KiCad-GenCAD-Exporter](https://gitlab.com/kicad/code/kicad/-/blob/master/pcbnew/exporters/export_gencad_writer.cpp)
und [OpenBoardView-GenCAD-Grammatik](https://github.com/OpenBoardView/OpenBoardView/blob/master/src/openboardview/FileFormats/GenCADFileBnf.h).
