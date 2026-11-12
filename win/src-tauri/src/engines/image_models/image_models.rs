
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    fn write(path: &Path, bytes: usize) {
        let mut file = File::create(path).expect("create");
        file.write_all(&vec![7u8; bytes]).expect("write");
    }

    #[test]
    fn repo_kind_follows_the_hub_task_and_tags() {
        assert!(is_image_repo("text-to-image", &[]));
        assert!(is_image_repo("", &["diffusers:StableDiffusionPipeline"]));
        assert!(!is_image_repo("text-generation", &["gguf"]));
    }

    #[test]
    fn catalogue_pins_are_well_formed() {
        for entry in CATALOGUE {
            for file in entry.files {
                assert_eq!(file.sha256.len(), 64, "{}", file.filename);
                assert!(file.size > 0);
            }
        }
        assert_eq!(role_flag("diffusion"), Some("--diffusion-model"));
        assert_eq!(role_flag("unknown"), None);
    }

    #[test]
    fn bundle_loads_with_role_flags_and_server_args() {
        let temp = dir();
        let z = catalogue_entry("z-image-turbo-q3").expect("z-image entry");
        for file in z.files {
            write(&temp.path().join(file.filename), file.size as usize);
        }
        let resolved = resolve_image_model(temp.path(), "z-image-turbo-q3").expect("resolves");
        let args = model_args(&resolved).expect("args");
        assert!(args.windows(2).any(|w| w[0] == "--diffusion-model"));
        assert!(args.windows(2).any(|w| w[0] == "--llm"));
        assert!(args.windows(2).any(|w| w[0] == "--vae"));
        assert_eq!(args.last().map(String::as_str), Some("--diffusion-fa"));
    }

    #[test]
    fn partial_files_are_not_resolved_and_are_listed_as_partial() {
        let temp = dir();
        write(&temp.path().join("stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf.unverified"), 10);
        assert!(resolve_image_model(temp.path(), "sd15-q8").is_none());
        let listed = list_image_models(temp.path());
        let sd = listed.iter().find(|m| m["id"] == "sd15-q8").expect("listed");
        assert_eq!(sd["installed"], false);
        assert_eq!(sd["partial"], true);
    }

    #[test]
    fn custom_files_are_listed_and_components_hidden() {
        let temp = dir();
        write(&temp.path().join("my-model.safetensors"), 4);
        write(&temp.path().join("notes.txt"), 4);
        let listed = list_image_models(temp.path());
        assert!(listed.iter().any(|m| m["id"] == "file:my-model.safetensors"));
        assert!(!listed.iter().any(|m| m["id"] == "file:notes.txt"));
    }

    #[test]
    fn record_family_round_trips_and_forgets() {
        let temp = dir();
        record_family(temp.path(), "abenzerps-Q4_K_M.gguf", Some("qwen-image-2.1")).expect("record");
        let map = read_family_map(temp.path());
        assert_eq!(map.get("abenzerps-Q4_K_M.gguf").and_then(Value::as_str), Some("qwen-image-2.1"));
        record_family(temp.path(), "abenzerps-Q4_K_M.gguf", None).expect("forget");
        assert!(read_family_map(temp.path()).get("abenzerps-Q4_K_M.gguf").is_none());
    }

    #[tokio::test]
    async fn install_rejects_a_hash_mismatch_and_keeps_nothing() {
        let temp = dir();
        let file = ModelFile {
            role: "model",
            hf_repo: "x/y",
            repo_path: None,
            filename: "pinned.gguf",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            size: 5,
        };
        let fetch = |request: DownloadRequest| {
            let path = PathBuf::from(&request.models_dir).join(&request.filename);
            async move {
                write(&path, 5);
                Ok(Downloaded { path, filename: request.filename.clone() })
            }
        };
        let result = install_files(&[file], temp.path(), fetch, |_| {}).await;
        assert!(matches!(result, Err(InstallError::Hash { .. })));
        assert!(!temp.path().join("pinned.gguf").exists());
        assert!(!temp.path().join("pinned.gguf.unverified").exists());
    }

    #[test]
    fn loras_list_by_name_only_for_model_extensions() {
        let temp = dir();
        write(&temp.path().join("style.safetensors"), 1);
        write(&temp.path().join("readme.md"), 1);
        let loras = list_loras(temp.path());
        assert_eq!(loras.len(), 1);
        assert_eq!(loras[0]["name"], "style");
    }
}
