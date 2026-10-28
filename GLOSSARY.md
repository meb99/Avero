# Avero

Boardviewer für die Elektronik-Reparatur auf dem Mac: Platine, Schaltplan und Werkstattwissen
in einer App, lokal und ohne Konto. Die Begriffe hier gelten für Gespräche, Code-Namen und Doku.

## Arbeitsfläche

**Reiter** (Code: `tabs`):
Ein geöffnetes Board mit seiner Datei, Seite, Drehung, Auswahl, seinen offenen Dokumenten und
seinem Bildausschnitt. Genau ein Reiter ist aktiv.
_Vermeiden_: Tab (im Gespräch), Fenster, Ansicht

**Reiter-Sammlung**:
Alle Reiter einschließlich des aktiven, als ein Modul mit einem Interface.
_Vermeiden_: Tab-Liste, live-Tab

**Infoleiste** (Code: `Sidebar`, `InfoSections`):
Die Leiste rechts vom Board, wie bei FlexBV aus aufklappbaren Abschnitten: Auswahlverlauf, Netz,
Lesezeichen, Wissen, gewählte Bauteile, dann Averos Werkzeuge (Details, Listen, Messen, Fehlersuche).
_Vermeiden_: Seitenleiste mit Reitern, Sidebar (im Gespräch)

**Board-Sitzung**:
Was die Infoleiste über das aktive Board wissen und tun kann: Board, Auswahl, Notizen,
Einstellungen und die Sprünge (Schaltplan, Lesezeichen, Markierungen).
_Vermeiden_: Kontext, Session-State

## Bedienung

**Befehl** (Code: `commands`):
Etwas, das man auslösen kann, mit Text in Deutsch und Englisch, Taste und der Regel, wann es
möglich ist.
_Vermeiden_: Aktion, Menüpunkt, Kommando

**Befehlsregister**:
Die eine Liste aller festen Befehle, aus der Menüleiste, Befehlspalette und Tastatur lesen.
_Vermeiden_: Action-Map, Shortcut-Liste

**Befehlstaste** (Code: `commandKey`):
Die Taste vor den Kürzeln: ⌘ auf dem Mac, Strg unter Windows. Gespeichert wird sie auf beiden
Systemen als `Cmd`, damit eine eingestellte Taste überall gilt. Texte schreiben die Tasten so, wie
das System sie nennt („⇧⌘E“ bzw. „Strg+Umschalt+E“).
_Vermeiden_: Meta-Taste, Modifier

**Auswahlverlauf** (Code: `selectionHistory`):
Was auf einem Board nacheinander ausgewählt war, zum Zurück- und Vorgehen wie im Browser. Je Board
eine Liste; alle Wege (Tasten, Menü, Palette, Maustasten) gehen durch dieselbe.
_Vermeiden_: History, Navigation

**Werkzeug** (Code: `boardTool`):
Was der nächste Klick aufs Board bedeutet: Zeichnen, Zeichnung verschieben, Lineal,
Markierung setzen oder Foto ausrichten. Es ist immer höchstens ein Werkzeug aktiv.
_Vermeiden_: Modus, Tool

## Board

**Verbindungsteil** (Code: `passesThrough`):
Ein Bauteil, das seine zwei Netze für die Netzverfolgung zu einem macht: Spule, Ferrit,
Sicherung, Jumper und Widerstand bis 1 Ω (ab 0.9.48, wie FlexBV; vorher nur 0 Ω).
_Vermeiden_: Brücke, Link-Part

**Netweb** (Code: `netWeb`, Einstellung `netWeb`):
Linien vom gewählten Pin zu allen anderen Pins seines Netzes, wie in OpenBoardView. Die
Verbindungslinien dagegen verbinden jeden Pin des Netzes mit seinem nächsten.
_Vermeiden_: Stern, Spinnennetz

**Abschirmungen und Rahmen** (Code: `mechanicalParts`, Einstellung `hideMechanical`):
Teile, die als Abschirmung oder Rahmen benannt sind, und Teile ab 25,4 mm nur an Masse oder an
keinem Netz. Ihr Körper ist von Anfang an ausgeblendet, ihre Pads bleiben.
_Vermeiden_: Mechanik, Shields
