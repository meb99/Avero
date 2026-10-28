# 1. Windows-Version aus demselben Code

Stand: Oktober 2026, Avero 0.9.48.

## Entscheidung

Avero gibt es für macOS und Windows aus demselben Code. Es gibt keinen eigenen Zweig und keine
abgespeckte Fassung. Was sich unterscheidet, steht an wenigen Stellen:

- **Tasten und Wörter** (`src/platform.ts`): Strg statt ⌘, „Strg+Umschalt+E“ statt „⇧⌘E“,
  Explorer statt Finder. Die Texte in `de.ts`/`en.ts` bleiben in der Mac-Schreibweise; die
  Übersetzung schreibt sie für Windows um.
- **Menü:** Auf dem Mac nimmt die native Menüleiste ihre Kürzel selbst an. Unter Windows zeigt die
  Menüleiste die Kürzel nur als Text, angenommen werden sie von der Web-Ansicht. Ob die
  Menükürzel bei fokussierter WebView2 sicher ankommen, ließ sich nicht prüfen. Doppelt auslösen
  dürfen sie nicht, sonst schaltet z. B. Strg+E den Schaltplan an und gleich wieder aus.
- **Update ohne Signaturschlüssel:** Auf dem Mac tauscht Avero das App-Bundle selbst. Unter
  Windows lädt es `Avero_<version>_x64-setup.exe` aus demselben Release und startet es passiv
  (`/P /R`). Das Update-Plugin von Tauri bräuchte einen privaten Signaturschlüssel als Geheimnis
  im Repository. Ein Update wird nur angeboten, wenn die Datei des eigenen Systems am Release
  hängt.
- **Installer:** NSIS für den eigenen Benutzer, ohne Administratorrechte und ohne MSI.
- **Allegro-Leser:** wird unter Windows mit cl.exe aus Visual Studio gebaut, die C++-Laufzeit
  ist fest eingebunden.

## Folgen

- Setup und App sind nicht signiert. SmartScreen warnt beim ersten Start, so wie Gatekeeper auf
  dem Mac.
- Die Windows-Fassung wird in der CI gebaut und geprüft (clippy, Tests, Setup). Bedient wird sie
  in den Browser-Tests mit `os: "windows"` (`tools/browser-tests/windows.mjs`). Auf einem echten
  Windows-Rechner hat sie vor 0.9.48 niemand gestartet.
