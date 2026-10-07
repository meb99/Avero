#!/usr/bin/env bash
# Runs the browser tests: the demo board always, plus every board JSON given.
#   tools/browser-tests/run.sh                      demo board only
#   tools/browser-tests/run.sh ~/boards/x.json      demo board and x.json
# A board JSON comes from: cargo run -q -p avero-formats --bin avero-inspect -- <board file> --json > x.json
# (keep those outside the repository: boards are vendor property).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
mkdir -p "$here/out"

[ -d "$here/node_modules/playwright" ] || (cd "$here" && npm install --no-audit --no-fund --silent)
cargo run -q --manifest-path "$root/Cargo.toml" -p avero-formats --bin avero-inspect -- --demo --json > "$here/out/demo.json"

# The app from the Vite dev server; started here unless one is running already.
server=""
if ! curl -sf -o /dev/null "${AVERO_URL:-http://localhost:1420/}"; then
  (cd "$root" && npx vite --port 1420 --strictPort > "$here/out/vite.log" 2>&1) &
  server=$!
  trap '[ -n "$server" ] && kill "$server" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -sf -o /dev/null http://localhost:1420/ && break; sleep 1; done
fi

status=0
for board in "$here/out/demo.json" "$@"; do
  node "$here/sweep.mjs" "$board" workshop || status=1
  node "$here/sweep.mjs" "$board" view || status=1
  node "$here/features.mjs" "$board" || status=1
done
node "$here/ui-levels.mjs" "$here/out/demo.json" || status=1
echo "Screenshots: $here/out"
exit $status
