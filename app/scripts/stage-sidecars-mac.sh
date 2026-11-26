#!/usr/bin/env bash
# The macOS stage-sidecars.ps1: copies pinned node, then ffmpeg and ffprobe, into src-tauri/binaries under Tauri's target-triple names.
# vendor/ holds the Apple silicon copies as node and <tool>, the Intel copies as node-x64 and <tool>-x64 (scripts/fetch-sidecars-unix.sh mac).
# A universal build stages both architectures and a lipo'd universal copy. A debug build may fall back to an unpinned ffmpeg on PATH.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
triple="${TAURI_ENV_TARGET_TRIPLE:-aarch64-apple-darwin}"
case "$triple" in
  aarch64-apple-darwin) arches="aarch64" ;;
  x86_64-apple-darwin) arches="x86_64" ;;
  universal-apple-darwin) arches="aarch64 x86_64" ;;
  *) echo "No macOS pin for $triple" >&2; exit 1 ;;
esac
pin="$here/node-pin-macos.json"
version="$(plutil -extract version raw -o - "$pin")"
vendor="$here/../vendor"
dir="$here/../src-tauri/binaries"
mkdir -p "$dir"
suffix() { if [ "$1" = x86_64 ]; then echo "-x64"; fi; }

for arch in $arches; do
  if [ "$arch" = x86_64 ]; then
    source="$vendor/node/node-x64"
    expected="$(plutil -extract x64.sha256 raw -o - "$pin")"
  else
    source="${1:-$vendor/node/node}"
    expected="$(plutil -extract sha256 raw -o - "$pin")"
  fi
  if [ ! -f "$source" ]; then
    echo "Pinned node missing at $source (expected $version for $arch)" >&2
    exit 1
  fi
  hash="$(shasum -a 256 "$source" | cut -d ' ' -f 1)"
  if [ "$hash" != "$expected" ]; then
    echo "node sha256 $hash does not match pin $version $expected ($arch)" >&2
    exit 1
  fi
  cp -f "$source" "$dir/node-$arch-apple-darwin"
  echo "staged node $version ($arch)"

  # fetch-sidecars-unix.sh checks the ffmpeg archives against ffmpeg-pin-macos.json.
  for tool in ffmpeg ffprobe; do
    src="$vendor/ffmpeg/$tool$(suffix "$arch")"
    from="vendor/ffmpeg"
    if [ ! -f "$src" ]; then
      if [ "${TAURI_ENV_DEBUG:-}" != "true" ] || [ "$arch" != aarch64 ]; then
        echo "$tool missing at $src; run scripts/fetch-sidecars-unix.sh mac" >&2
        exit 1
      fi
      src="$(command -v "$tool" || true)"
      from="PATH"
    fi
    if [ -z "$src" ]; then
      echo "$tool missing from vendor/ffmpeg and PATH" >&2
      exit 1
    fi
    cp -f "$src" "$dir/$tool-$arch-apple-darwin"
    chmod u+w "$dir/$tool-$arch-apple-darwin"
    echo "staged $tool from $from ($arch)"
  done
done

if [ "$triple" = universal-apple-darwin ]; then
  for tool in node ffmpeg ffprobe; do
    lipo -create -output "$dir/$tool-universal-apple-darwin" \
      "$dir/$tool-aarch64-apple-darwin" "$dir/$tool-x86_64-apple-darwin"
  done
  echo "staged universal sidecars"
fi
