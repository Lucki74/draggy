#!/usr/bin/env bash
# The Linux stage-sidecars.ps1: copies pinned node, then ffmpeg and ffprobe, into src-tauri/binaries under Tauri's target-triple names.
# Linux has no pinned ffmpeg yet, so it is staged only when TAURI_ENV_DEBUG=true (tauri dev, tauri build --debug).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
triple="${TAURI_ENV_TARGET_TRIPLE:-x86_64-unknown-linux-gnu}"
if [ "$triple" != "x86_64-unknown-linux-gnu" ]; then
  echo "Only x86_64 Linux is pinned; cannot stage sidecars for $triple" >&2
  exit 1
fi
pin="$here/node-pin-linux.json"
field() { node -p "require(process.argv[1]).$1" "$pin"; }
version="$(field version)"
expected="$(field sha256)"
source="${1:-$here/../vendor/node/node}"
if [ ! -f "$source" ]; then
  echo "Pinned node missing at $source (expected $version from $(field archive))" >&2
  exit 1
fi
hash="$(sha256sum "$source" | cut -d ' ' -f 1)"
if [ "$hash" != "$expected" ]; then
  echo "node sha256 $hash does not match pin $version $expected" >&2
  exit 1
fi
dir="$here/../src-tauri/binaries"
mkdir -p "$dir"
cp -f "$source" "$dir/node-$triple"
echo "staged node $version"

if [ "${TAURI_ENV_DEBUG:-}" != "true" ]; then
  echo "No pinned ffmpeg for Linux yet; only a debug build (TAURI_ENV_DEBUG=true) may stage an unpinned one" >&2
  exit 1
fi
for tool in ffmpeg ffprobe; do
  src="$here/../vendor/ffmpeg/$tool"
  from="vendor/ffmpeg"
  if [ ! -f "$src" ]; then
    src="$(command -v "$tool" || true)"
    from="PATH"
  fi
  if [ -z "$src" ]; then
    echo "$tool missing from vendor/ffmpeg and PATH" >&2
    exit 1
  fi
  cp -f "$src" "$dir/$tool-$triple"
  chmod u+w "$dir/$tool-$triple"
  echo "staged unpinned $tool from $from for a debug build"
done
