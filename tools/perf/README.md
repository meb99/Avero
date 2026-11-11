# Tempo messen

Misst, wie lange Avero an einem großen Board rechnet: Laden, Auswählen, Suchen, Zoomen, Listen.
Die Boards sind künstlich erzeugt (keine Herstellerdaten) und werden nicht eingecheckt.

```sh
# 1. Ein Board erzeugen (GenCAD im Stil des XZZ-Konverters) und einlesen
python3 tools/perf/gen-board.py 5000 tools/browser-tests/out/gross.cad      # 57.000 Pins
python3 tools/perf/gen-board.py 20000 tools/browser-tests/out/riesig.cad    # 229.000 Pins
cargo build --release -p avero-formats --bin avero-inspect
time target/release/avero-inspect tools/browser-tests/out/gross.cad --json > tools/browser-tests/out/gross.json

# 2. Im Browser messen (Dev-Server muss laufen: npx vite --port 1420 --strictPort)
node tools/perf/perf.mjs tools/browser-tests/out/gross.json
node tools/perf/perf.mjs tools/browser-tests/out/gross.json "load (open from recent until idle)"   # nur ein Schritt
```

Je Schritt gibt `perf.mjs` aus: die Zeit bis zur Ruhe (`wall`), die Rechenzeit des Programms
(`busy`, aus einem CPU-Profil) und die Funktionen, die am meisten davon brauchten.

**Was die Zahlen sagen und was nicht:** `busy` ist die Rechenzeit von Avero selbst und gilt auf
jedem Rechner ähnlich. `wall` enthält hier das Zeichnen mit Software-Grafik (kein Grafikchip im
Testrechner) und sagt nichts über einen echten Mac oder PC. Wie flüssig Zoomen und Verschieben auf
echter Grafikkarte sind, lässt sich so nicht messen.

## Stand 0.9.49

Rechenzeit (`busy`) im Dev-Server, vor und nach den Korrekturen von 0.9.49:

| Schritt | groß: 57.000 Pins, 73.000 Leiterbahnen | riesig: 229.000 Pins, 287.000 Leiterbahnen |
| --- | --- | --- |
| Datei lesen (Rust, GenCAD 32 MB / 130 MB) | 0,65 s | 3,2 s |
| Board öffnen bis zur Ruhe | 1,8 s → 1,3 s | 4,5 s → 3,5 s |
| Befehlspalette, fünf Zeichen tippen | 0,51 s → 0,25 s | 1,6 s → 0,41 s |
| Bauteil wählen bei offenen Listen | 0,83 s → 0,60 s | 1,5 s → 0,99 s |
| Netz, Bauteil oder Schiene wählen | 0,3–0,4 s | 0,4–0,8 s |
| Abschnitt „Fehlersuche“ öffnen | 0,56 s | 1,1 s |

Was 0.9.49 behoben hat:

- Eine neue Board-Ansicht lud ihr Board zweimal zur Grafikkarte und rechnete Farben und
  Verbindungslinien doppelt (`BoardView`, Test `tools/browser-tests/load.mjs`).
- Die Befehlspalette sortierte bei jedem Tastendruck alle Treffer, obwohl sie nur 30 zeigt
  (`core/search.ts`).
- Die Gruppen „Abschirmungen / nur Masse / ohne Netz“ wurden bei jeder Auswahl neu aus allen
  Bauteilen berechnet (`HiddenParts`).

Bekannt und gelassen, weil erst weit jenseits echter Boards spürbar:

- Der GenCAD-Leser verbringt rund ein Viertel seiner Zeit mit kleinen Speicheranforderungen
  (je Zeile ein kopierter Name).
- Der Ortsindex trägt sehr lange Leiterbahnen in viele Zellen ein (1 s beim Riesenboard, dessen
  künstliche Leiterbahnen quer über das ganze Board laufen).
