//! Generates the foreign-language bindings from the compiled library:
//! `cargo run -p draggy-core --bin uniffi-bindgen -- generate --library <lib> --language swift --out-dir <dir>`.

fn main() {
    uniffi::uniffi_bindgen_main();
}
