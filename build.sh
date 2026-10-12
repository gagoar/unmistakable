#!/usr/bin/env bash
# Cross-compile ste-lint into runtime-free binaries under ./bin.
# Needs Go once, on the maintainer or CI machine. Users need nothing installed.
# The Go version is pinned in .go-version so a rebuild reproduces the committed bytes.
#
# ./build.sh assets   redraw docs/assets/*.png from docs/assets/*.html (needs Chrome)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
bin="$here/bin"
mkdir -p "$bin"

case "${1:-}" in
  assets)
    chrome="${CHROME:-}"
    for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
      [ -n "$chrome" ] && break
      if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then chrome="$c"; fi
    done
    [ -n "$chrome" ] || { echo "build.sh: set CHROME to a Chrome or Chromium binary" >&2; exit 1; }
    shot() { # html width height out
      "$chrome" --headless --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$3" \
        --screenshot="$here/docs/assets/$4" "file://$here/docs/assets/$1" >/dev/null 2>&1
      echo "wrote docs/assets/$4"
    }
    shot icon.html 1024 1024 icon.png
    shot og.html 1200 630 og.png
    cp "$here/docs/assets/icon.png" "$here/.claude-plugin/icon.png"
    exit 0
    ;;
esac

want="go$(tr -d '[:space:]' < .go-version)"
have="$(go env GOVERSION)"
if [ "$have" != "$want" ] && [ "${ALLOW_GO_MISMATCH:-}" != "1" ]; then
  echo "build.sh: need $want (see .go-version), have $have. Set ALLOW_GO_MISMATCH=1 to build anyway." >&2
  exit 1
fi

version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -1)"
[ -n "$version" ] || { echo "build.sh: no version in .claude-plugin/plugin.json" >&2; exit 1; }

build() {
  local goos="$1" goarch="$2" ext="${3:-}"
  echo "building $goos/$goarch..."
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -trimpath -buildvcs=false -ldflags "-s -w -X main.version=$version" \
    -o "$bin/ste-lint-$goos-$goarch$ext" ./cmd/ste-lint
}

build darwin arm64
build darwin amd64
build linux amd64
build linux arm64
build windows amd64 .exe

echo "done: ste-lint $version"
ls -l "$bin" | awk 'NR>1 {print $5, $9}'
