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

**Board-Sitzung**:
Was die Seitenleiste über das aktive Board wissen und tun kann: Board, Auswahl, Notizen,
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

**Werkzeug** (Code: `boardTool`):
Was der nächste Klick aufs Board bedeutet: Zeichnen, Zeichnung verschieben, Lineal,
Markierung setzen oder Foto ausrichten. Es ist immer höchstens ein Werkzeug aktiv.
_Vermeiden_: Modus, Tool
