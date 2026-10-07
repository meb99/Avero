# Browser-Tests

Prüfen die Oberfläche im Browser gegen den Vite-Entwicklungsserver. Die Tauri-Seite ist
durch eine Attrappe ersetzt: Sie liefert ein Board (JSON aus `avero-inspect --json`) und
hält Notizen und Speicher im Arbeitsspeicher. Es wird nichts auf die Platte geschrieben
außer Screenshots in `out/`.

```sh
tools/browser-tests/run.sh                    # Demo-Board
tools/browser-tests/run.sh ~/boards/a.json    # zusätzlich eigene Boards
```

Einmalig: `cd tools/browser-tests && npm install && npx playwright install chromium`.
Mit `CHROMIUM=/pfad/zu/chromium` wird ein vorhandenes Chromium benutzt.

| Skript | Prüft |
| --- | --- |
| `sweep.mjs [board.json] [view\|workshop]` | Suche, alle Reiter, Leitfäden, Tasten, Klicks, Palette, Einstellungen, Hilfe, Bibliothek, BGA, Signalweg – jeder Seitenfehler zählt |
| `features.mjs [board.json]` | Jumper-Plan, BGA-Ansicht, Hinweise, Reparaturchronik mit vorbereitetem Fall, Screenshots |
| `ui-levels.mjs [board.json] [Bauteil]` | Stufen „Ansehen“ und „Werkstatt“, Screenshots, gespeicherte Stufe |

Ein Board als JSON:

```sh
cargo run -q -p avero-formats --bin avero-inspect -- <Boarddatei> --json > ~/boards/a.json
```

Boarddateien und ihre JSONs gehören Herstellern: außerhalb des Repositorys ablegen, nie committen.
`out/` und `node_modules/` werden nicht eingecheckt.
