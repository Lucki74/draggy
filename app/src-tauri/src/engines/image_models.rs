//! Image models: the catalogue, what is in the image folder, how a model is loaded and installed.
//! Families and request rules live in the submodules.

pub mod families;
pub mod requests;

use std::fs::{self, File};
use std::future::Future;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::engines::sd::Defaults;
use crate::models::large_store::sha256_file;
use draggy_models::download::{DownloadError, DownloadRequest, Downloaded};
use draggy_models::gguf::{GgufHeader, read_header};
use families::{Family, ModelFile};

/// Staged name a file downloads under until its hash matches; the image folder never lists it.
pub const UNVERIFIED: &str = ".unverified";
const FAMILY_FILE: &str = "families.json";
const IMAGE_EXTENSIONS: &[&str] = &[".gguf", ".safetensors", ".ckpt", ".sft"];

/// An image model Draggy offers by name. Every file is pinned by hash; no repository needs an account.
pub struct CatalogueEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub variant: &'static str,
    pub kind: &'static str,
    pub files: &'static [ModelFile],
    pub vram_gb: f64,
    pub server_args: &'static [&'static str],
    pub defaults: Defaults,
    pub license: &'static str,
    pub license_url: &'static str,
}

const fn file(
    role: &'static str,
    hf_repo: &'static str,
    repo_path: Option<&'static str>,
    filename: &'static str,
    sha256: &'static str,
    size: u64,
) -> ModelFile {
    ModelFile {
        role,
        hf_repo,
        repo_path,
        filename,
        sha256,
        size,
    }
}

const fn defaults(width: f64, steps: i64, cfg_scale: f64, max_side: f64) -> Defaults {
    Defaults {
        width,
        height: width,
        steps,
        cfg_scale: Some(cfg_scale),
        max_side: Some(max_side),
    }
}

const SD15_LICENSE: &str = "CreativeML OpenRAIL-M";
const SD15_LICENSE_URL: &str = "https://huggingface.co/spaces/CompVis/stable-diffusion-license";

pub const CATALOGUE: &[CatalogueEntry] = &[
    CatalogueEntry {
        id: "sd15-q8",
        name: "Stable Diffusion 1.5",
        variant: "Q8_0",
        kind: "single",
        files: &[file(
            "model",
            "second-state/stable-diffusion-v1-5-GGUF",
            None,
            "stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf",
            "d0555243938c62faeefb4ac93f6c7a053ad373a4290c5256bce229aeb193bf94",
            1_763_578_176,
        )],
        vram_gb: 2.5,
        server_args: &[],
        defaults: defaults(512.0, 20, 7.0, 768.0),
        license: SD15_LICENSE,
        license_url: SD15_LICENSE_URL,
    },
    CatalogueEntry {
        id: "sd15-q4",
        name: "Stable Diffusion 1.5",
        variant: "Q4_0",
        kind: "single",
        files: &[file(
            "model",
            "second-state/stable-diffusion-v1-5-GGUF",
            None,
            "stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf",
            "b8944e9fe0b69b36ae1b5bb0185b3a7b8ef14347fe0fa9af6c64c4829022261f",
            1_566_768_416,
        )],
        vram_gb: 2.0,
        server_args: &[],
        defaults: defaults(512.0, 20, 7.0, 768.0),
        license: SD15_LICENSE,
        license_url: SD15_LICENSE_URL,
    },
    CatalogueEntry {
        id: "z-image-turbo-q3",
        name: "Z-Image Turbo",
        variant: "Q3_K",
        kind: "bundle",
        files: &[
            file(
                "diffusion",
                "leejet/Z-Image-Turbo-GGUF",
                None,
                "z_image_turbo-Q3_K.gguf",
                "4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980",
                3_143_559_104,
            ),
            file(
                "llm",
                "unsloth/Qwen3-4B-Instruct-2507-GGUF",
                None,
                "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
                "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
                2_497_281_120,
            ),
            file(
                "vae",
                "Comfy-Org/z_image_turbo",
                Some("split_files/vae/ae.safetensors"),
                "z-image-ae.safetensors",
                "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
                335_304_388,
            ),
        ],
        vram_gb: 6.0,
        // Flash attention in the diffusion model is what the upstream guide runs this model with.
        server_args: &["--diffusion-fa"],
        defaults: defaults(1024.0, 8, 1.0, 1024.0),
        license: "Apache 2.0",
        license_url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
];

/// How sd-server is told which file plays which part. A single-file model is one `-m`.
pub fn role_flag(role: &str) -> Option<&'static str> {
    Some(match role {
        "model" => "-m",
        "diffusion" => "--diffusion-model",
        "vae" => "--vae",
        "llm" => "--llm",
        "llm_vision" => "--llm_vision",
        "clip_l" => "--clip_l",
        "clip_g" => "--clip_g",
        "t5xxl" => "--t5xxl",
        _ => return None,
    })
}

/// LoRA files live in a folder of their own inside the image folder.
pub fn loras_dir(image_dir: &Path) -> PathBuf {
    image_dir.join("loras")
}

pub fn is_image_file_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

pub fn catalogue_entry(id: &str) -> Option<&'static CatalogueEntry> {
    CATALOGUE.iter().find(|entry| entry.id == id)
}

/// Hugging Face says what a repository is for; an image one is downloaded here, not beside chat models.
pub fn is_image_repo(task: &str, tags: &[&str]) -> bool {
    const IMAGE_TASKS: &[&str] = &[
        "text-to-image",
        "image-to-image",
        "unconditional-image-generation",
    ];
    if IMAGE_TASKS.contains(&task) {
        return true;
    }
    tags.iter().any(|tag| {
        let lower = tag.to_lowercase();
        IMAGE_TASKS.contains(&lower.as_str())
            || lower == "diffusers"
            || lower.starts_with("diffusers:")
    })
}

fn size_of(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Bytes of a catalogue file fetched so far: the staged copy, or the transfer's partial.
fn staged_bytes(dir: &Path, file: &ModelFile) -> u64 {
    let staged = dir.join(format!("{}{UNVERIFIED}", file.filename));
    let partial = dir.join(format!("{}{UNVERIFIED}.download", file.filename));
    size_of(&staged).max(size_of(&partial)).min(file.size)
}

/// Families recorded at download, for a file whose own name does not say what it is.
fn read_family_map(dir: &Path) -> serde_json::Map<String, Value> {
    fs::read_to_string(dir.join(FAMILY_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

/// Records, or with `None` forgets, the family of a downloaded file.
pub fn record_family(dir: &Path, filename: &str, family: Option<&str>) -> std::io::Result<()> {
    let mut map = read_family_map(dir);
    match family {
        Some(id) => {
            map.insert(filename.to_owned(), Value::from(id));
        }
        None => {
            map.remove(filename);
        }
    }
    fs::create_dir_all(dir)?;
    let text =
        serde_json::to_string_pretty(&Value::Object(map)).unwrap_or_else(|_| "{}".to_owned());
    fs::write(dir.join(FAMILY_FILE), text)
}

/// GGUF header of a file, if it parses. Anything else gives None.
fn gguf_header(path: &Path) -> Option<GgufHeader> {
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
    {
        return None;
    }
    let mut file = File::open(path).ok()?;
    read_header(&mut file).ok()
}

/// A text encoder, not a model to pick: only a language model records a context length.
pub fn is_component_file(path: &Path) -> bool {
    gguf_header(path).is_some_and(|header| header.context_length.is_some())
}

/// The family of a file in the image folder: recorded at download, else read from its name and architecture.
pub fn family_of_file(
    dir: &Path,
    name: &str,
    map: &serde_json::Map<String, Value>,
) -> Option<&'static Family> {
    if let Some(family) = map
        .get(name)
        .and_then(Value::as_str)
        .and_then(families::family_by_id)
    {
        return Some(family);
    }
    let architecture = gguf_header(&dir.join(name))
        .map(|h| h.architecture)
        .unwrap_or_default();
    families::family_of(&[name, architecture.as_str()])
}

fn defaults_json(d: &Defaults) -> Value {
    json!({
        "width": d.width,
        "height": d.height,
        "steps": d.steps,
        "cfgScale": d.cfg_scale,
        "maxSide": d.max_side,
    })
}

/// A model file the user downloaded, with the encoders and VAE its family needs beside it.
fn custom_entry(dir: &Path, name: &str, map: &serde_json::Map<String, Value>) -> Value {
    let family = family_of_file(dir, name, map);
    let parts = family.map(families::parts_of).unwrap_or_default();
    let mut files = vec![json!({
        "role": family.map_or("model", |f| f.main),
        "filename": name,
        "size": size_of(&dir.join(name)),
        "present": true,
    })];
    for part in &parts {
        files.push(json!({
            "role": part.role,
            "filename": part.filename,
            "size": part.size,
            "present": size_of(&dir.join(part.filename)) == part.size,
        }));
    }
    let complete = files.iter().all(|f| f["present"] == true);
    let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
    let mut entry = json!({
        "id": format!("file:{name}"),
        "name": stem,
        "variant": "",
        "kind": if parts.is_empty() { "single" } else { "bundle" },
        "family": family.map(|f| f.id),
        "curated": false,
        "installed": complete,
        "partial": !complete,
        "size": files.iter().map(|f| f["size"].as_u64().unwrap_or(0)).sum::<u64>(),
        "vramGB": 0,
        "defaults": defaults_json(&families::defaults_for(family, &[name])),
        "referenceMode": families::reference_mode_of(family, &[name]),
        "license": "",
        "licenseUrl": "",
        "files": files,
    });
    if let Some(args) = server_args_of(family) {
        entry["serverArgs"] = args;
    }
    entry
}

/// The `serverArgs` field of a file model: an empty list without a family, none when the family has no arguments.
fn server_args_of(family: Option<&families::Family>) -> Option<Value> {
    match family {
        None => Some(json!([])),
        Some(f) if !f.server_args.is_empty() => Some(json!(f.server_args)),
        Some(_) => None,
    }
}

#[cfg(test)]
mod server_args_tests {
    use super::*;

    #[test]
    fn server_args_key_is_omitted_when_the_family_has_none() {
        assert_eq!(server_args_of(None), Some(json!([])));
    }
}

/// The catalogue with what is on disk, then any other model file the user put in the folder themselves.
pub fn list_image_models(dir: &Path) -> Vec<Value> {
    let names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| is_image_file_name(n))
                .collect()
        })
        .unwrap_or_default();
    let map = read_family_map(dir);
    let mut claimed: Vec<&str> = CATALOGUE
        .iter()
        .flat_map(|entry| entry.files.iter().map(|f| f.filename))
        .collect();
    claimed.extend(families::component_filenames());

    let mut out: Vec<Value> = CATALOGUE
        .iter()
        .map(|entry| {
            let files: Vec<Value> = entry
                .files
                .iter()
                .map(|file| {
                    let present = names.iter().any(|n| n == file.filename)
                        && size_of(&dir.join(file.filename)) == file.size;
                    let on_disk = if present {
                        file.size
                    } else {
                        staged_bytes(dir, file)
                    };
                    json!({
                        "role": file.role,
                        "filename": file.filename,
                        "size": file.size,
                        "present": present,
                        "onDisk": on_disk,
                    })
                })
                .collect();
            let installed = files.iter().all(|f| f["present"] == true);
            let any_bytes = files.iter().any(|f| f["onDisk"].as_u64().unwrap_or(0) > 0);
            json!({
                "id": entry.id,
                "name": entry.name,
                "variant": entry.variant,
                "kind": entry.kind,
                "curated": true,
                "installed": installed,
                "partial": any_bytes && !installed,
                "size": entry.files.iter().map(|f| f.size).sum::<u64>(),
                "onDiskBytes": files.iter().map(|f| f["onDisk"].as_u64().unwrap_or(0)).sum::<u64>(),
                "vramGB": entry.vram_gb,
                "defaults": defaults_json(&entry.defaults),
                "license": entry.license,
                "licenseUrl": entry.license_url,
                "files": files,
            })
        })
        .collect();

    for name in names.iter().filter(|n| !claimed.contains(&n.as_str())) {
        if is_component_file(&dir.join(name)) {
            continue;
        }
        out.push(custom_entry(dir, name, &map));
    }
    out
}

/// A model ready to start: its id, display name, family and the full path of each role's file.
pub struct Resolved {
    pub id: String,
    pub name: String,
    pub family: Option<&'static Family>,
    pub server_args: &'static [&'static str],
    pub paths: Vec<(&'static str, PathBuf)>,
}

fn size_matches(path: &Path, size: u64) -> bool {
    size_of(path) == size
}

/// A model ready to start, or None if any file is missing. `id` is a catalogue id or `file:<name>`.
pub fn resolve_image_model(dir: &Path, id: &str) -> Option<Resolved> {
    if let Some(entry) = catalogue_entry(id) {
        let mut paths = Vec::new();
        for file in entry.files {
            let full = dir.join(file.filename);
            if !size_matches(&full, file.size) {
                return None;
            }
            paths.push((file.role, full));
        }
        return Some(Resolved {
            id: entry.id.to_owned(),
            name: entry.name.to_owned(),
            family: None,
            server_args: entry.server_args,
            paths,
        });
    }
    let raw = id.strip_prefix("file:")?;
    let name = Path::new(raw).file_name()?.to_str()?.to_owned();
    let full = dir.join(&name);
    if !is_image_file_name(&name) || !full.exists() {
        return None;
    }
    let map = read_family_map(dir);
    let family = family_of_file(dir, &name, &map);
    let mut paths = vec![(family.map_or("model", |f| f.main), full)];
    for part in family.map(families::parts_of).unwrap_or_default() {
        let path = dir.join(part.filename);
        if !size_matches(&path, part.size) {
            return None;
        }
        paths.push((part.role, path));
    }
    Some(Resolved {
        id: format!("file:{name}"),
        name: name
            .rsplit_once('.')
            .map_or(name.clone(), |(s, _)| s.to_owned()),
        family,
        server_args: family.map_or(&[][..], |f| f.server_args),
        paths,
    })
}

/// The arguments that load this model, file roles mapped onto sd-server's flags.
pub fn model_args(resolved: &Resolved) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    for (role, path) in &resolved.paths {
        let flag = role_flag(role).ok_or_else(|| format!("Unknown model file role: {role}"))?;
        args.push(flag.to_owned());
        args.push(path.to_string_lossy().into_owned());
    }
    args.extend(resolved.server_args.iter().map(|s| (*s).to_owned()));
    Ok(args)
}

/// The model's memory need in GB: the catalogue's figure, or the files' size when it has none.
pub fn memory_need_gb(resolved: &Resolved, vram_gb: f64) -> f64 {
    if vram_gb > 0.0 {
        return vram_gb;
    }
    let bytes: u64 = resolved.paths.iter().map(|(_, p)| size_of(p)).sum();
    ((bytes as f64) / 1024f64.powi(3) * 1.3).max(1.0)
}

/// Progress of one model install: bytes done across all files, and the stage it is in.
#[derive(Debug, Clone, PartialEq)]
pub struct InstallProgress {
    pub completed: u64,
    pub total: u64,
    pub stage: &'static str,
}

/// Why an install stopped short.
#[derive(Debug, Clone, PartialEq)]
pub enum InstallError {
    Cancelled,
    Download(String),
    Hash { filename: String },
    Io(String),
}

/// Fetches each file not yet in `dir` under its staged name, then gives it its real name only once its SHA-256
/// matches. `fetch` downloads one request; progress is reported through `on_progress`.
pub async fn install_files<F, Fut>(
    files: &[ModelFile],
    dir: &Path,
    mut fetch: F,
    mut on_progress: impl FnMut(InstallProgress),
) -> Result<(), InstallError>
where
    F: FnMut(DownloadRequest) -> Fut,
    Fut: Future<Output = Result<Downloaded, DownloadError>>,
{
    let total: u64 = files.iter().map(|f| f.size).sum();
    let mut before = 0u64;
    for file in files {
        let target = dir.join(file.filename);
        if !size_matches(&target, file.size) {
            let staged = format!("{}{UNVERIFIED}", file.filename);
            let mut request = DownloadRequest::new(file.url(), dir, &staged);
            request.keep_extension = true;
            let downloaded = match fetch(request).await {
                Ok(done) => done,
                Err(DownloadError::Cancelled) => return Err(InstallError::Cancelled),
                Err(error) => return Err(InstallError::Download(error.to_string())),
            };
            on_progress(InstallProgress {
                completed: before,
                total,
                stage: "model-verify",
            });
            let hash =
                sha256_file(&downloaded.path).map_err(|e| InstallError::Io(e.to_string()))?;
            if hash != file.sha256 {
                let _ = fs::remove_file(&downloaded.path);
                return Err(InstallError::Hash {
                    filename: file.filename.to_owned(),
                });
            }
            fs::rename(&downloaded.path, &target).map_err(|e| InstallError::Io(e.to_string()))?;
        }
        before += file.size;
        on_progress(InstallProgress {
            completed: before,
            total,
            stage: "model-download",
        });
    }
    on_progress(InstallProgress {
        completed: total,
        total,
        stage: "model-done",
    });
    Ok(())
}

/// LoRA files in the loras folder, by the name a request uses.
pub fn list_loras(dir: &Path) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| {
            let lower = n.to_lowercase();
            [".safetensors", ".gguf", ".ckpt", ".pt"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        })
        .map(|file| {
            let name = file
                .rsplit_once('.')
                .map_or(file.clone(), |(s, _)| s.to_owned());
            json!({ "name": name, "file": file })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
        let z = catalogue_entry("z-image-turbo-q3").expect("z-image entry");
        let resolved = Resolved {
            id: z.id.to_owned(),
            name: z.name.to_owned(),
            family: None,
            server_args: z.server_args,
            paths: z
                .files
                .iter()
                .map(|f| (f.role, PathBuf::from(f.filename)))
                .collect(),
        };
        let args = model_args(&resolved).expect("args");
        assert!(args.windows(2).any(|w| w[0] == "--diffusion-model"));
        assert!(args.windows(2).any(|w| w[0] == "--llm"));
        assert!(args.windows(2).any(|w| w[0] == "--vae"));
        assert_eq!(args.last().map(String::as_str), Some("--diffusion-fa"));
    }

    #[test]
    fn partial_files_are_not_resolved_and_are_listed_as_partial() {
        let temp = tempfile::tempdir().expect("temp dir");
        write(
            &temp
                .path()
                .join("stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf.unverified"),
            10,
        );
        assert!(resolve_image_model(temp.path(), "sd15-q8").is_none());
        let listed = list_image_models(temp.path());
        let sd = listed
            .iter()
            .find(|m| m["id"] == "sd15-q8")
            .expect("listed");
        assert_eq!(sd["installed"], false);
        assert_eq!(sd["partial"], true);
    }

    #[test]
    fn custom_files_are_listed_and_text_is_not() {
        let temp = tempfile::tempdir().expect("temp dir");
        write(&temp.path().join("my-model.safetensors"), 4);
        write(&temp.path().join("notes.txt"), 4);
        let listed = list_image_models(temp.path());
        assert!(
            listed
                .iter()
                .any(|m| m["id"] == "file:my-model.safetensors")
        );
        assert!(!listed.iter().any(|m| m["id"] == "file:notes.txt"));
    }

    #[test]
    fn record_family_round_trips_and_forgets() {
        let temp = tempfile::tempdir().expect("temp dir");
        record_family(temp.path(), "abenzerps-Q4_K_M.gguf", Some("qwen-image-2.1"))
            .expect("record");
        let map = read_family_map(temp.path());
        assert_eq!(
            map.get("abenzerps-Q4_K_M.gguf").and_then(Value::as_str),
            Some("qwen-image-2.1")
        );
        record_family(temp.path(), "abenzerps-Q4_K_M.gguf", None).expect("forget");
        assert!(
            read_family_map(temp.path())
                .get("abenzerps-Q4_K_M.gguf")
                .is_none()
        );
    }

    #[tokio::test]
    async fn install_rejects_a_hash_mismatch_and_keeps_nothing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file = ModelFile {
            role: "model",
            hf_repo: "x/y",
            repo_path: None,
            filename: "pinned.gguf",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            size: 5,
        };
        let dir = temp.path().to_path_buf();
        let fetch = move |request: DownloadRequest| {
            let path = dir.join(&request.filename);
            async move {
                write(&path, 5);
                Ok(Downloaded {
                    path,
                    filename: request.filename.clone(),
                })
            }
        };
        let result = install_files(&[file], temp.path(), fetch, |_| {}).await;
        assert!(matches!(result, Err(InstallError::Hash { .. })));
        assert!(!temp.path().join("pinned.gguf").exists());
        assert!(!temp.path().join("pinned.gguf.unverified").exists());
    }

    #[test]
    fn loras_list_by_name_only_for_model_extensions() {
        let temp = tempfile::tempdir().expect("temp dir");
        write(&temp.path().join("style.safetensors"), 1);
        write(&temp.path().join("readme.md"), 1);
        let loras = list_loras(temp.path());
        assert_eq!(loras.len(), 1);
        assert_eq!(loras[0]["name"], "style");
    }
}
