//! Compiles the Blueprint templates to GtkBuilder XML, then bundles them and the stylesheet as a GResource.

use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=resources");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let built = out.join("ui");
    std::fs::create_dir_all(&built).expect("create the template output folder");
    let mut blueprints: Vec<PathBuf> = std::fs::read_dir("ui")
        .expect("read ui folder")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "blp"))
        .collect();
    blueprints.sort();
    if !blueprints.is_empty() {
        let status = Command::new("blueprint-compiler")
            .arg("batch-compile")
            .arg(&built)
            .arg("ui")
            .args(&blueprints)
            .status()
            .expect("blueprint-compiler must be installed (apt install blueprint-compiler)");
        assert!(status.success(), "blueprint-compiler failed");
    }
    glib_build_tools::compile_resources(
        &["resources", built.to_str().expect("utf-8 out dir")],
        "resources/draggy.gresource.xml",
        "draggy.gresource",
    );
}
