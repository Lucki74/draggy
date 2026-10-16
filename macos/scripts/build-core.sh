#!/usr/bin/env bash
# Builds the Rust core for Apple Silicon, generates the Swift bindings and packs the XCFramework that
# Packages/DraggyCore expects. Needs a Mac with Xcode and Rust. Run it before xcodegen.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
package="$root/macos/Packages/DraggyCore"
work="$root/macos/build/core"
target=aarch64-apple-darwin

rustup target add "$target"

cd "$root/core"
cargo build -p draggy-core --lib --release --locked --target "$target"

rm -rf "$work" "$package/DraggyCoreFFI.xcframework"
mkdir -p "$work/headers" "$package/Sources/DraggyCore"

cargo run -p draggy-core --bin uniffi-bindgen --locked -- generate \
  --library "target/$target/release/libdraggy_core.a" \
  --language swift --out-dir "$work/bindings"

cp "$work/bindings/draggy_core.swift" "$package/Sources/DraggyCore/draggy_core.swift"
cp "$work/bindings/draggy_coreFFI.h" "$work/headers/draggy_coreFFI.h"
cp "$work/bindings/draggy_coreFFI.modulemap" "$work/headers/module.modulemap"

xcodebuild -create-xcframework \
  -library "target/$target/release/libdraggy_core.a" \
  -headers "$work/headers" \
  -output "$package/DraggyCoreFFI.xcframework"
