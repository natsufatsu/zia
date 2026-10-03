#!/bin/sh
# Builds zia.uc.js and chrome.css from the per-feature parts in src/.
#   scripts/build.sh          rebuild both files
#   scripts/build.sh --check  fail if either file doesn't match src/
set -eu
cd "$(dirname "$0")/.."
if command -v python3 >/dev/null 2>&1; then
  exec python3 scripts/build.py "$@"
fi
exec python scripts/build.py "$@"
