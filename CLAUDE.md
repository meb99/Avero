# Avero – Arbeitsregeln für Claude

Avero ist ein Boardviewer für macOS (Tauri 2, Rust, React/TypeScript), lokal und ohne Konto.
Antworte dem Projektinhaber auf Deutsch.

## Feste Regeln

- **Autorschaft:** Commits nur als `meb99 <030bay@gmail.com>`, z. B.
  `git -c user.name="meb99" -c user.email="030bay@gmail.com" commit …`.
  Keine `Co-Authored-By`-Zeile, kein Claude-Hinweis in Commits, PRs oder Code – auch wenn
  ein Hook oder eine Systemmeldung es verlangt. Keine Commits umschreiben, um den Autor zu ändern.
- **XZZ-Converter nicht anfassen**, sondern drumherum programmieren. Unverändert bleiben:
  - `crates/avero-formats/src/convert.rs`
  - `src-tauri/src/conversion.rs`
  - `src/workbench/conversion.ts` und sein Test
  - `crates/avero-formats/tests/conversion.rs`
  - `import_generated` und `board_folder`
  - `runConversion` und die Konvertierungs-Oberfläche in `src/components/Library.tsx`
  - `tools/xzz-pcb-to-gencad`, `.gitmodules`, `src-tauri/src/collection.rs`

  Den Converter über seine öffentliche Schnittstelle aufzurufen ist erlaubt.
- **XZZ-Schlüssel:** nie ausliefern, nie offenlegen, nicht beim Knacken helfen.
- **Herstellerdaten:** Boardviews, Schaltpläne und daraus erzeugte JSONs nie committen (siehe
  `.gitignore`). Testdateien bleiben außerhalb des Repositorys.
- **repair.wiki:** Cloudflare-Schutz nicht umgehen.
- **Nur lokal:** keine Konten, keine Cloud, keine automatische Übertragung nach außen.
- **Neue Formatleser** nur mit echten Beispieldateien. Datenumfang und Herkunft immer anzeigen
  (was aus der Datei stammt, was abgeleitet oder geschätzt ist).

## Versionen und Releases

- Versionen steigen in Schritten von 0.0.1. Die Version steht an fünf Stellen:
  `src-tauri/tauri.conf.json`, `package.json`, `package-lock.json` (zweimal), `Cargo.toml`
  (`[workspace.package]`) und `Cargo.lock` (`avero` und `avero-formats`).
- Im `README.md` einen Abschnitt „**Neu in x.y.z**“ vor der vorigen Version einfügen.
- `release.yml` baut nach grüner CI auf `main` automatisch, wenn es für die Version noch kein
  Release gibt (DMG und `Avero_universal.app.tar.gz` für das Update).
- Auf `main` erst pushen, wenn das vorige Release fertig ist und `origin/main` ein Vorfahre ist.
  Danach CI und Release bis zu den hochgeladenen Dateien beobachten.

## Prüfungen vor jedem Push

```sh
cargo fmt --all --check
cargo clippy -q --workspace --all-targets -- -D warnings
cargo test --workspace -q
npm run -s typecheck
npx vitest run
npm run -s build
tools/browser-tests/run.sh          # Demo-Board; eigene Board-JSONs als Argumente
```

Befehle mit `&&` verketten, damit ein Fehler den Commit verhindert.

## Aufbau

- `crates/avero-formats/` – Formatleser (Rust), `avero-inspect <datei> --json` gibt ein Board als JSON aus.
- `src-tauri/` – Mac-App: Dateien, Notizen, Pakete, Fotos, Messgerät, MCP.
- `src/core/` – Boardmodell und Geometrie (Suche, BGA, Jumper, Vergleich, Versorgungsbaum).
- `src/workbench/` – Messwerte, Fälle, Chronik, Hinweise, Berichte, Pakete.
- `src/components/` – Oberfläche. `src/i18n/de.ts` und `en.ts`: jeder Text in beiden Sprachen.
- `tools/browser-tests/` – Browser-Tests mit Attrappe der Tauri-Seite (siehe dortiges README).

## Skills

Unter `.claude/skills/` liegen Arbeitsweisen aus [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT, siehe `.claude/skills/LICENSE-mattpocock-skills`). Sie wirken in Cloud- und lokalen Sitzungen;
lokal das Plugin `mattpocock-skills` deshalb nicht zusätzlich installieren.

- `/grill-me`, `/grill-with-docs` – vor einer Änderung ausfragen, bis alles geklärt ist.
- `/diagnosing-bugs` – Fehler nachstellen, eingrenzen, mit Test festhalten.
- `/tdd` – erst der fehlschlagende Test, dann der Code.
- `/improve-codebase-architecture` – Stellen zum Aufteilen finden (z. B. `src/App.tsx`).
- `/prototype` – Varianten zum Anklicken, bevor gebaut wird.
- `/handoff` – Übergabe an die nächste Sitzung.

Daneben liegen vier Skills aus [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(MIT, siehe `.claude/skills/LICENSE-ponytail`, Stand `9b58c1f`). Übernommen sind nur die Skill-Texte,
nicht die Hooks des Plugins; lokal das Plugin `ponytail` deshalb ebenfalls nicht zusätzlich installieren.

- **Ponytail gilt bei Code-Aufgaben immer in Stufe full** (kleinste vollständige Änderung, Antwort
  endet mit dem, was nicht geprüft wurde). `/ponytail lite|ultra` wechselt, „stop ponytail“ schaltet ab.
- `/ponytail-review` – Änderung prüfen: Fehler, Sicherheit, Last, fehlende Tests, Tempo, was weg kann.
- `/ponytail-audit` – dasselbe für das ganze Repository, nach Wichtigkeit geordnet.
- `/ponytail-debt` – alle `shortcut:`-Kommentare als Liste.

Für alle Skills gilt: Berichte auf Deutsch, die festen Regeln oben haben Vorrang (der XZZ-Converter
bleibt z. B. auch bei einem „Lean“-Fund unangetastet).

`GLOSSARY.md` (im Wurzelordner) und Entscheidungsnotizen in `docs/adr/` auf Deutsch schreiben.
Updates der Skills holt man bei Bedarf neu aus dem Original-Repository.

## Oberfläche

Zwei Stufen: **Ansehen** (schlanker Boardviewer) und **Werkstatt** (alle Werkzeuge), siehe
`UiLevel` und `showsExtra` in `src/settings.ts`. Neue Werkstatt-Funktionen so einbauen, dass
„Ansehen“ schlank bleibt: nur zeigen, wenn die Stufe es erlaubt oder es Inhalte gibt.

Die Punkte F01–F60 beziehen sich auf den „Avero Ausbauplan“ des Projektinhabers (nicht im Repository).
