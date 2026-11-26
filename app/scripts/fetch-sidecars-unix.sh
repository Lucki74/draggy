#!/usr/bin/env bash
# Fetches the pinned node, ffmpeg and ffprobe for a macOS or Linux release build into vendor/ and checks every SHA-256.
# Usage: fetch-sidecars-unix.sh mac|linux
# mac writes Apple silicon copies as vendor/node/node and vendor/ffmpeg/<tool>, Intel copies with a -x64 suffix.
set -euo pipefail

os="${1:?usage: fetch-sidecars-unix.sh mac|linux}"
here="$(cd "$(dirname "$0")" && pwd)"
vendor="$here/../vendor"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d ' ' -f 1; }
check() {
  local got
  got="$(sha "$1")"
  if [ "$got" != "$2" ]; then
    echo "$1 sha256 $got does not match pin $2" >&2
    exit 1
  fi
}
field() { node -p "require(process.argv[1]).$2" "$1"; }

case "$os" in
  mac) node_pin="$here/node-pin-macos.json"; ffmpeg_pin="$here/ffmpeg-pin-macos.json"; arches="arm64 x64" ;;
  linux) node_pin="$here/node-pin-linux.json"; ffmpeg_pin="$here/ffmpeg-pin-linux.json"; arches="x64" ;;
  *) echo "unknown system $os" >&2; exit 1 ;;
esac
mkdir -p "$vendor/node" "$vendor/ffmpeg"
version="$(field "$node_pin" version)"

for arch in $arches; do
  # The node pin keeps the native archive at the top level and other architectures under their own key.
  if [ "$os" = mac ] && [ "$arch" = x64 ]; then key="x64."; suffix="-x64"; else key=""; suffix=""; fi
  archive="$(field "$node_pin" "${key}archive")"
  curl -sSfL -o "$work/$archive" "https://nodejs.org/dist/$version/$archive"
  check "$work/$archive" "$(field "$node_pin" "${key}archiveSha256")"
  tar -xf "$work/$archive" -C "$work"
  cp "$work/${archive%.tar.*}/bin/node" "$vendor/node/node$suffix"
  check "$vendor/node/node$suffix" "$(field "$node_pin" "${key}sha256")"
  echo "fetched node $version ($arch)"

  for tool in ffmpeg ffprobe; do
    zip="$work/$tool-$arch.zip"
    curl -sSfL -o "$zip" "$(field "$ffmpeg_pin" "$arch.$tool.url")"
    check "$zip" "$(field "$ffmpeg_pin" "$arch.$tool.sha256")"
    rm -rf "$work/unzip" && mkdir "$work/unzip"
    unzip -q "$zip" -d "$work/unzip"
    found="$(find "$work/unzip" -type f -name "$tool" | head -1)"
    if [ -z "$found" ]; then
      echo "$tool missing from $(field "$ffmpeg_pin" "$arch.$tool.url")" >&2
      exit 1
    fi
    cp "$found" "$vendor/ffmpeg/$tool$suffix"
    chmod 755 "$vendor/ffmpeg/$tool$suffix"
    echo "fetched $tool $(field "$ffmpeg_pin" version) ($arch)"
  done
done
