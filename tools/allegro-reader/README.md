# Local Allegro reader

This separate executable uses the GPL-3.0 `brd_parser` core by Yigit Berna
(https://github.com/bernayigit/brd_parser), revision
`f38fb8f48031eb78d654a78a79453e580b634f93`.
Its complete corresponding source is included here, under `LICENSE`.
It is not linked to Avero's MIT Rust library. Avero runs it locally and reads
its JSON output through a file. No network service or installed CAD tool is used.

Changes: Boost mapping replaced by an owned buffer and standard maps; bounded
input counts, strings and record advancement; strict rejection of unknown object
types; added a boardview exporter. The supported reader versions are Allegro
16.0–17.4. Older and newer binary variants are reported as unsupported.

The exporter reads placed components, named pins, their explicit nets, pad sizes,
vias and copper lines/arcs. Assembly polygons, copper fills and drawing text are
reported as unconverted. Pin/body bounds must never be presented as original
board contours.

Build with a C++20 compiler. `src-tauri/build.rs` builds this executable for each
desktop target and embeds it for local use. On macOS it is signed ad hoc, like
the application. No user Terminal step is required.
