# Vergleich mit FlexBV und NexusBV

Stand Oktober 2026. Grundlage sind nur öffentliche Quellen, keine zerlegten Programme:
das [FlexBV-5-Handbuch](https://pldaniels.com/flexbv5/manual/) und die
[NexusBV-Seite](https://nexusbv.net/) mit Changelog (v0.9). Ideen und Bedienkonzepte übernimmt
Avero, Code nicht.

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
| Board 60 % neben dem Schaltplan | ab 0.9.44 (vorher 50 %) |
| Infoleiste stört beim Öffnen nicht | ab 0.9.44: Seitenleiste eingeklappt bis zur ersten Auswahl |
| Mechanische Teile ausgeblendet | ab 0.9.44: Abschirmungen und Rahmen ohne Körper, Pads bleiben; abschaltbar |
| Rechtsklick → Schaltplan | ab 0.9.44 |
| Mittelklick → andere Seite | ab 0.9.44 |
| Constellation (Verbindungslinien mit wenig Ästen) | Verbindungslinien als minimaler Spannbaum |
| Butterfly / Dual View | beide Seiten nebeneinander, getrennt oder gekoppelt |
| Netz über 0-Ω, Spulen, Sicherungen verfolgen (Mycelium) | „Weiter über“ |
| Multisearch (gemeinsame Netze mehrerer Bauteile) | Mehrfachauswahl mit gemeinsamen Netzen |
| Part Find in einer PDF-Sammlung | Inhaltssuche der Bibliothek, auch mit Bereich |
| OBData, Multimeter, Minimap, Text nach Größe, Tooltips | vorhanden |
| NexusBV: Reiter, Notizen, Lesezeichen, Board-Editor, Tasten- und Farbeditor, MCP, dunkle PDF-Seiten | vorhanden |

## Noch offen

Ohne Beispieldateien (Formate brauchen nach den Regeln des Projekts echte Dateien):

- **Allegro binär ab 18** (NexusBV liest 16–25, Avero 16.0–17.4).
- **F2B, A3P, FAZ, BVRE, ASR** – kein verifizierter Decoder.
- **Teboview TVW** – Leser vorhanden, aber an keiner echten Datei abgenommen; damit auch kein
  Silkscreen (FlexBV zeigt ihn nur bei TVW).

Ohne Dateien machbar, als nächste Schritte:

- **Mycelium-Stufen:** das gewählte Netz automatisch über Verbindungsteile erweitern (Stufe 1–3),
  Verbindungsteile mit Raute markiert, verbundene Netze in eigenen Farben.
- **Auswahlverlauf sichtbar** in der Seitenleiste („Inspection History“).
- **Tooltip mit Messwerten** (Referenz, OBData) am Pin.
- **Netweb** als zweite Linienart (Stern vom gewählten Pin aus).
- **Zoom-Ring** um den Mauszeiger beim Zoomen.
