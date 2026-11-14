use tauri_build::{AppManifest, Attributes};

fn main() {
    // Test binaries link Tauri but get no application manifest, so Windows loads comctl32 v5 and the
    // binary fails to start (STATUS_ENTRYPOINT_NOT_FOUND). Ask the MSVC linker for the v6 dependency.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        // The lib's unit-test binary gets no manifest; delay-loading comctl32 keeps it starting.
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-lib=delayimp");
    }
    // Listing the commands makes Tauri generate `allow-ipc-invoke`, `allow-ipc-send` and `allow-ipc-stage`, which the
    // capability file grants to the main window only.
    let manifest = AppManifest::new().commands(&["ipc_invoke", "ipc_send", "ipc_stage", "gateway_info"]);
    tauri_build::try_build(Attributes::new().app_manifest(manifest))
        .expect("failed to run the Tauri build step");
}
