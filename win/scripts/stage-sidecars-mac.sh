#!/usr/bin/env bash
# The macOS stage-sidecars.ps1: copies pinned node, then ffmpeg and ffprobe, into src-tauri/binaries under Tauri's target-triple names.
# macOS has no pinned ffmpeg yet, so it is staged only when TAURI_ENV_DEBUG=true (tauri dev, tauri build --debug).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
triple="${TAURI_ENV_TARGET_TRIPLE:-aarch64-apple-darwin}"
if [ "$triple" != "aarch64-apple-darwin" ]; then
  echo "Only Apple silicon is pinned; cannot stage sidecars for $triple" >&2
  exit 1
fi
pin="$here/node-pin-macos.json"
version="$(plutil -extract version raw -o - "$pin")"
expected="$(plutil -extract sha256 raw -o - "$pin")"
source="${1:-$here/../vendor/node/node}"
if [ ! -f "$source" ]; then
  echo "Pinned node missing at $source (expected $version from $(plutil -extract archive raw -o - "$pin"))" >&2
  exit 1
fi
hash="$(shasum -a 256 "$source" | cut -d ' ' -f 1)"
if [ "$hash" != "$expected" ]; then
  echo "node sha256 $hash does not match pin $version $expected" >&2
  exit 1
fi
dir="$here/../src-tauri/binaries"
mkdir -p "$dir"
cp -f "$source" "$dir/node-$triple"
echo "staged node $version"

if [ "${TAURI_ENV_DEBUG:-}" != "true" ]; then
  echo "No pinned ffmpeg for macOS yet; only a debug build (TAURI_ENV_DEBUG=true) may stage an unpinned one" >&2
  exit 1
fi
from="vendor/ffmpeg"
for tool in ffmpeg ffprobe; do
  src="$here/../vendor/ffmpeg/$tool"
  if [ ! -f "$src" ]; then
    src="$(command -v "$tool" || true)"
    from="PATH"
  fi
  if [ -z "$src" ]; then
    echo "$tool missing from vendor/ffmpeg and PATH" >&2
    exit 1
  fi
  cp -f "$src" "$dir/$tool-$triple"
done
echo "staged unpinned ffmpeg and ffprobe from $from for a debug build"
