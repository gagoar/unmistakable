#!/usr/bin/env bash
# Render the page images from docs/assets/*.html with headless Chrome. Needs Chrome or Chromium.
# Run it after a change to a page in docs/assets, and commit the images it writes.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chrome="${CHROME:-}"
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  [ -n "$chrome" ] && break
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then chrome="$c"; fi
done
[ -n "$chrome" ] || { echo "render-assets: set CHROME to a Chrome or Chromium binary" >&2; exit 1; }
# shot PAGE WIDTH HEIGHT DIR: renders docs/assets/PAGE to DIR, named like the page with a .png extension.
shot() {
  local out="$4/${1%.html}.png"
  "$chrome" --headless --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$3" \
    --screenshot="$out" "file://$here/docs/assets/$1" >/dev/null 2>&1
  echo "wrote ${out#"$here"/}"
}
shot icon.html 1024 1024 "$here/docs/assets"
shot og.html 1200 630 "$here/docs/assets"
shot icon.html 1024 1024 "$here/.claude-plugin"

