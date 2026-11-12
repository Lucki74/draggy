//! Image model families: the family a file belongs to, the encoders and VAE it needs beside it, its defaults and
//! how it takes a reference picture. Port of electron/imageFamilies.cjs.

use std::sync::LazyLock;

use regex::Regex;

use crate::engines::sd::Defaults;

/// A file an image model is made of, pinned by its repository, name, size and SHA-256.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelFile {
    /// The part the file plays (`model`, `diffusion`, `vae`, `llm`, ...); empty for a shared component.
    pub role: &'static str,
    pub hf_repo: &'static str,
    pub repo_path: Option<&'static str>,
    pub filename: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

impl ModelFile {
    /// The Hugging Face address the file is fetched from.
    pub fn url(&self) -> String {
        let in_repo = self.repo_path.unwrap_or(self.filename);
        format!(
            "https://huggingface.co/{}/resolve/main/{in_repo}?download=true",
            self.hf_repo
        )
    }
}

const fn component(
    hf_repo: &'static str,
    repo_path: Option<&'static str>,
    filename: &'static str,
    sha256: &'static str,
    size: u64,
) -> ModelFile {
    ModelFile {
        role: "",
        hf_repo,
        repo_path,
        filename,
        sha256,
        size,
    }
}

/// Text encoders and VAEs, each pinned and shared by every family that uses it. None needs an account.
pub const COMPONENTS: &[(&str, ModelFile)] = &[
    (
        "flux-vae",
        component(
            "Comfy-Org/z_image_turbo",
            Some("split_files/vae/ae.safetensors"),
            "z-image-ae.safetensors",
            "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
            335_304_388,
        ),
    ),
    (
        "flux2-vae",
        component(
            "Comfy-Org/flux2-dev",
            Some("split_files/vae/flux2-vae.safetensors"),
            "flux2-vae.safetensors",
            "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5",
            336_213_556,
        ),
    ),
    (
        "qwen-image-vae",
        component(
            "Comfy-Org/Qwen-Image_ComfyUI",
            Some("split_files/vae/qwen_image_vae.safetensors"),
            "qwen_image_vae.safetensors",
            "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
            253_806_246,
        ),
    ),
    (
        "qwen-image-2.1-vae",
        component(
            "Comfy-Org/Qwen-Image-2.1",
            Some("vae/qwen_image_2.1_vae_bf16.safetensors"),
            "qwen_image_2.1_vae_bf16.safetensors",
            "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9",
            675_509_688,
        ),
    ),
    (
        "wan-2.1-vae",
        component(
            "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
            Some("split_files/vae/wan_2.1_vae.safetensors"),
            "wan_2.1_vae.safetensors",
            "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
            253_815_318,
        ),
    ),
    (
        "clip-l",
        component(
            "comfyanonymous/flux_text_encoders",
            None,
            "clip_l.safetensors",
            "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
            246_144_152,
        ),
    ),
    (
        "clip-g",
        component(
            "Comfy-Org/stable-diffusion-3.5-fp8",
            Some("text_encoders/clip_g.safetensors"),
            "clip_g.safetensors",
            "ec310df2af79c318e24d20511b601a591ca8cd4f1fce1d8dff822a356bcdb1f4",
            1_389_382_176,
        ),
    ),
    (
        "t5xxl",
        component(
            "comfyanonymous/flux_text_encoders",
            None,
            "t5xxl_fp8_e4m3fn.safetensors",
            "7d330da4816157540d6bb7838bf63a0f02f573fc48ca4d8de34bb0cbfd514f09",
            4_893_934_904,
        ),
    ),
    (
        "qwen2.5-vl-7b",
        component(
            "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
            None,
            "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf",
            "0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94",
            4_683_072_512,
        ),
    ),
    (
        "qwen2.5-vl-7b-vision",
        component(
            "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
            None,
            "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf",
            "2185ca0adf339f96845318c7b666f5d242f86bbace5657a89cb834785d0cea57",
            853_119_712,
        ),
    ),
    (
        "qwen3-vl-8b",
        component(
            "unsloth/Qwen3-VL-8B-Instruct-GGUF",
            None,
            "Qwen3-VL-8B-Instruct-Q4_K_M.gguf",
            "108e7ff92b78eefd3db4741885104acba514255c11b617d3c7b197a5f46efe89",
            5_027_785_568,
        ),
    ),
    (
        "qwen3-vl-4b",
        component(
            "Qwen/Qwen3-VL-4B-Instruct-GGUF",
            None,
            "Qwen3VL-4B-Instruct-Q4_K_M.gguf",
            "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a",
            2_497_281_664,
        ),
    ),
    (
        "qwen3-4b-instruct",
        component(
            "unsloth/Qwen3-4B-Instruct-2507-GGUF",
            None,
            "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
            "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
            2_497_281_120,
        ),
    ),
    (
        "qwen3-4b",
        component(
            "unsloth/Qwen3-4B-GGUF",
            None,
            "Qwen3-4B-Q4_K_M.gguf",
            "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a",
            2_497_281_312,
        ),
    ),
    (
        "qwen3-8b",
        component(
            "unsloth/Qwen3-8B-GGUF",
            None,
            "Qwen3-8B-Q4_K_M.gguf",
            "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4",
            5_027_784_512,
        ),
    ),
    (
        "qwen3-0.6b-base",
        component(
            "circlestone-labs/Anima",
            Some("split_files/text_encoders/qwen_3_06b_base.safetensors"),
            "qwen_3_06b_base.safetensors",
            "cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba",
            1_192_135_096,
        ),
    ),
    (
        "mistral-small-24b",
        component(
            "unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF",
            None,
            "Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf",
            "a3cc56310807ed0d145eaf9f018ccda9ae7ad8edb41ec870aa2454b0d4700b3c",
            14_333_922_848,
        ),
    ),
    (
        "ministral-3b",
        component(
            "unsloth/Ministral-3-3B-Instruct-2512-GGUF",
            None,
            "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf",
            "fd46fc371ff0509bfa8657ac956b7de8534d7d9baaa4947975c0648c3aa397f4",
            2_146_497_824,
        ),
    ),
    (
        "ovis-2.5",
        component(
            "Comfy-Org/Ovis-Image",
            Some("split_files/text_encoders/ovis_2.5.safetensors"),
            "ovis_2.5.safetensors",
            "f453ee5e7a25cb23cf2adf7aae3e5b405f22097cb67f2cfcca029688cb3f740d",
            5_140_950_080,
        ),
    ),
];

/// Sizes every family draws at: 1024 wide, with the steps and guidance given and the fit limit the app uses.
const fn size(steps: i64, cfg_scale: f64) -> Defaults {
    Defaults {
        width: 1024.0,
        height: 1024.0,
        steps,
        cfg_scale: Some(cfg_scale),
        max_side: Some(1280.0),
    }
}

/// One image model family. `test` matches the lower-cased repository and file names together.
pub struct Family {
    pub id: &'static str,
    pub test: &'static str,
    pub unless: Option<&'static str>,
    /// The role the downloaded file plays.
    pub main: &'static str,
    /// Each other role and the component that fills it, in load order.
    pub parts: &'static [(&'static str, &'static str)],
    pub server_args: &'static [&'static str],
    pub defaults: Defaults,
    pub turbo: Option<Defaults>,
    pub schnell: Option<Defaults>,
    pub base: Option<Defaults>,
}

const FLASH_ATTENTION: &[&str] = &["--diffusion-fa"];

/// Checked in order: the first family whose pattern matches wins.
pub const FAMILIES: &[Family] = &[
    Family {
        id: "qwen-image-2.1",
        test: r"qwen[-_ ]?image[-_ ]?2[._]\d(\D|$)",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-vl-8b"), ("vae", "qwen-image-2.1-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(20, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "qwen-image-edit",
        test: r"qwen[-_ ]?image[-_ ]?edit",
        unless: None,
        main: "diffusion",
        parts: &[
            ("llm", "qwen2.5-vl-7b"),
            ("llm_vision", "qwen2.5-vl-7b-vision"),
            ("vae", "qwen-image-vae"),
        ],
        server_args: FLASH_ATTENTION,
        defaults: size(20, 2.5),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "qwen-image",
        test: r"qwen[-_ ]?image",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen2.5-vl-7b"), ("vae", "qwen-image-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(20, 2.5),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "longcat-image",
        test: r"longcat",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen2.5-vl-7b"), ("vae", "flux-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(20, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "z-image",
        test: r"z[-_ ]?image",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-4b-instruct"), ("vae", "flux-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(28, 5.0),
        turbo: Some(size(8, 1.0)),
        schnell: None,
        base: None,
    },
    Family {
        id: "ovis-image",
        test: r"ovis[-_ ]?image",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "ovis-2.5"), ("vae", "flux-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(20, 5.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "anima",
        test: r"(^|[^a-z])anima(\d|[^a-z]|$)",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-0.6b-base"), ("vae", "qwen-image-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(30, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "ernie-image",
        test: r"ernie[-_ ]?image",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "ministral-3b"), ("vae", "flux2-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(30, 4.0),
        turbo: Some(size(8, 1.0)),
        schnell: None,
        base: None,
    },
    Family {
        id: "krea-2",
        test: r"krea[-_ ]?2",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-vl-4b"), ("vae", "wan-2.1-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(28, 4.0),
        turbo: Some(size(8, 1.0)),
        schnell: None,
        base: None,
    },
    Family {
        id: "flux2-klein-9b",
        test: r"flux[-_. ]?2.*klein.*9b",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-8b"), ("vae", "flux2-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(4, 1.0),
        turbo: None,
        schnell: None,
        base: Some(size(20, 4.0)),
    },
    Family {
        id: "flux2-klein-4b",
        test: r"flux[-_. ]?2.*klein",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "qwen3-4b"), ("vae", "flux2-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(4, 1.0),
        turbo: None,
        schnell: None,
        base: Some(size(20, 4.0)),
    },
    Family {
        id: "flux2-dev",
        test: r"flux[-_. ]?2",
        unless: None,
        main: "diffusion",
        parts: &[("llm", "mistral-small-24b"), ("vae", "flux2-vae")],
        server_args: FLASH_ATTENTION,
        defaults: size(28, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "chroma-radiance",
        test: r"chroma.*radiance",
        unless: None,
        main: "diffusion",
        parts: &[("t5xxl", "t5xxl")],
        server_args: &[],
        defaults: size(26, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "chroma",
        test: r"chroma",
        unless: None,
        main: "diffusion",
        parts: &[("t5xxl", "t5xxl"), ("vae", "flux-vae")],
        server_args: &[],
        defaults: size(26, 4.0),
        turbo: None,
        schnell: None,
        base: None,
    },
    Family {
        id: "flux",
        test: r"flux|kontext",
        unless: None,
        main: "diffusion",
        parts: &[
            ("clip_l", "clip-l"),
            ("t5xxl", "t5xxl"),
            ("vae", "flux-vae"),
        ],
        server_args: &[],
        defaults: size(20, 1.0),
        turbo: None,
        schnell: Some(size(4, 1.0)),
        base: None,
    },
    // A checkpoint with its encoders built in loads alone, like any Stable Diffusion file.
    Family {
        id: "sd3",
        test: r"(^|[^a-z0-9])sd[-_ ]?3|stable[-_ ]?diffusion[-_ ]?3",
        unless: Some(r"incl[-_]?clips"),
        main: "model",
        parts: &[
            ("clip_l", "clip-l"),
            ("clip_g", "clip-g"),
            ("t5xxl", "t5xxl"),
        ],
        server_args: &[],
        defaults: size(28, 4.5),
        turbo: None,
        schnell: None,
        base: None,
    },
];

struct Matcher {
    test: Regex,
    unless: Option<Regex>,
}

static MATCHERS: LazyLock<Vec<Matcher>> = LazyLock::new(|| {
    FAMILIES
        .iter()
        .map(|family| Matcher {
            test: Regex::new(family.test).expect("family pattern compiles"),
            unless: family
                .unless
                .map(|pattern| Regex::new(pattern).expect("family exclusion compiles")),
        })
        .collect()
});

static SDXL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"sdxl|[-_ ]xl[-_ .]|xl[-_]?base|pony|illustrious|noob|animagine|juggernaut")
        .expect("sdxl pattern compiles")
});
static TURBO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"turbo|distill|lightning").expect("turbo pattern compiles"));
static SCHNELL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"schnell").expect("schnell pattern compiles"));
static BASE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"base").expect("base pattern compiles"));
static EDIT_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"kontext|[-_ ]edit").expect("edit pattern compiles"));

/// Families whose pictures are edited by showing the model the original, not by adding noise to it.
const EDIT_FAMILIES: &[&str] = &[
    "qwen-image-edit",
    "flux2-klein-9b",
    "flux2-klein-4b",
    "flux2-dev",
];

/// The lower-cased hints joined with spaces, empty hints dropped.
fn joined(hints: &[&str]) -> String {
    hints
        .iter()
        .filter(|hint| !hint.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The family a model belongs to, read from its repository, file name and GGUF architecture together.
pub fn family_of(hints: &[&str]) -> Option<&'static Family> {
    let text = joined(hints);
    FAMILIES
        .iter()
        .zip(MATCHERS.iter())
        .find(|(_, matcher)| {
            matcher.test.is_match(&text)
                && !matcher
                    .unless
                    .as_ref()
                    .is_some_and(|unless| unless.is_match(&text))
        })
        .map(|(family, _)| family)
}

/// The family with this id, if there is one.
pub fn family_by_id(id: &str) -> Option<&'static Family> {
    FAMILIES.iter().find(|family| family.id == id)
}

/// The size, steps and guidance a model draws with when nobody says otherwise.
pub fn defaults_for(family: Option<&Family>, hints: &[&str]) -> Defaults {
    let text = joined(hints);
    let Some(family) = family else {
        return if SDXL.is_match(&text) {
            Defaults {
                width: 1024.0,
                height: 1024.0,
                steps: 25,
                cfg_scale: Some(7.0),
                max_side: Some(1280.0),
            }
        } else {
            Defaults {
                width: 512.0,
                height: 512.0,
                steps: 20,
                cfg_scale: Some(7.0),
                max_side: Some(768.0),
            }
        };
    };
    if let Some(turbo) = family.turbo.filter(|_| TURBO.is_match(&text)) {
        return turbo;
    }
    if let Some(schnell) = family.schnell.filter(|_| SCHNELL.is_match(&text)) {
        return schnell;
    }
    if let Some(base) = family.base.filter(|_| BASE.is_match(&text)) {
        return base;
    }
    family.defaults
}

/// How a model takes a reference picture: "edit" (the original goes in as a reference image), "img2img" (it is
/// the starting point, noised by the strength), or "img2img" for a plain checkpoint.
pub fn reference_mode_of(family: Option<&Family>, hints: &[&str]) -> &'static str {
    let text = joined(hints);
    let edit_family = family.is_some_and(|family| EDIT_FAMILIES.contains(&family.id));
    if edit_family || EDIT_NAME.is_match(&text) {
        "edit"
    } else {
        "img2img"
    }
}

/// The component with this id, pinned as the catalogue has it.
pub fn component_by_id(id: &str) -> Option<ModelFile> {
    COMPONENTS
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, file)| *file)
}

/// The components a family needs, each carrying the role it plays.
pub fn parts_of(family: &Family) -> Vec<ModelFile> {
    family
        .parts
        .iter()
        .filter_map(|(role, id)| component_by_id(id).map(|file| ModelFile { role, ..file }))
        .collect()
}

/// The file names of every shared component, which the image folder never lists as a model.
pub fn component_filenames() -> impl Iterator<Item = &'static str> {
    COMPONENTS.iter().map(|(_, file)| file.filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAMED: &[(&str, &str, &str)] = &[
        (
            "QuantStack/Qwen-Image-GGUF",
            "Qwen_Image-Q4_K_M.gguf",
            "qwen-image",
        ),
        (
            "unsloth/Qwen-Image-2512-GGUF",
            "qwen-image-2512-Q4_K_M.gguf",
            "qwen-image",
        ),
        (
            "QuantStack/Qwen-Image-Edit-2509-GGUF",
            "Qwen-Image-Edit-2509-Q4_K_M.gguf",
            "qwen-image-edit",
        ),
        (
            "leejet/Qwen-Image-2.1-GGUF",
            "qwen_image_2.1-Q4_K.gguf",
            "qwen-image-2.1",
        ),
        (
            "KasugaiSakura/Qwen-Image-2.1-Uncensored-Abenzerps",
            "abenzerps-Q4_K_M.gguf",
            "qwen-image-2.1",
        ),
        (
            "leejet/Z-Image-Turbo-GGUF",
            "z_image_turbo-Q4_K.gguf",
            "z-image",
        ),
        (
            "leejet/FLUX.1-schnell-gguf",
            "flux1-schnell-q4_k.gguf",
            "flux",
        ),
        (
            "QuantStack/FLUX.1-Kontext-dev-GGUF",
            "flux1-kontext-dev-Q4_K_M.gguf",
            "flux",
        ),
        (
            "leejet/FLUX.2-klein-4B-GGUF",
            "flux-2-klein-4b-Q4_K.gguf",
            "flux2-klein-4b",
        ),
        (
            "leejet/FLUX.2-klein-9B-GGUF",
            "flux-2-klein-9b-Q4_K.gguf",
            "flux2-klein-9b",
        ),
        (
            "city96/FLUX.2-dev-gguf",
            "flux2-dev-Q4_K_M.gguf",
            "flux2-dev",
        ),
        (
            "silveroxides/Chroma-GGUF",
            "chroma-unlocked-v40-Q4_K_M.gguf",
            "chroma",
        ),
        (
            "silveroxides/Chroma1-Radiance-GGUF",
            "Chroma1-Radiance-Q4_K_M.gguf",
            "chroma-radiance",
        ),
        (
            "city96/stable-diffusion-3.5-large-gguf",
            "sd3.5_large-Q4_0.gguf",
            "sd3",
        ),
        (
            "vantagewithai/LongCat-Image-GGUF",
            "LongCat-Image-Q4_K_M.gguf",
            "longcat-image",
        ),
        (
            "leejet/Ovis-Image-7B-GGUF",
            "ovis_image-Q4_0.gguf",
            "ovis-image",
        ),
        ("Bedovyy/Anima-GGUF", "anima-preview-Q8_0.gguf", "anima"),
        (
            "unsloth/ERNIE-Image-Turbo-GGUF",
            "ernie-image-turbo-Q4_K_M.gguf",
            "ernie-image",
        ),
        ("realrebelai/KREA-2_GGUFs", "Krea-2-Raw-Q8_0.gguf", "krea-2"),
    ];

    fn is_hex64(text: &str) -> bool {
        text.len() == 64
            && text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    #[test]
    fn named_repositories_route_to_their_family() {
        for (repo, file, family) in NAMED {
            assert_eq!(
                family_of(&[repo, file]).map(|f| f.id),
                Some(*family),
                "{repo}"
            );
        }
        assert_eq!(
            family_of(&["Qwen-Image-Edit-2509-Q4_K_M.gguf"]).map(|f| f.id),
            Some("qwen-image-edit")
        );
        assert_eq!(
            family_of(&["flux1-dev-Q4_0.gguf"]).map(|f| f.id),
            Some("flux")
        );
    }

    #[test]
    fn plain_checkpoints_and_built_in_encoders_load_alone() {
        assert!(
            family_of(&[
                "second-state/stable-diffusion-v1-5-GGUF",
                "v1-5-pruned-emaonly-Q8_0.gguf"
            ])
            .is_none()
        );
        assert!(
            family_of(&[
                "gpustack/stable-diffusion-xl-base-1.0-GGUF",
                "sd_xl_base_1.0-Q4_0.gguf"
            ])
            .is_none()
        );
        assert!(
            family_of(&[
                "someone/Animagine-XL-4.0-GGUF",
                "animagine-xl-4.0-Q8_0.gguf"
            ])
            .is_none()
        );
        assert!(family_of(&["x/sd3", "sd3_medium_incl_clips_t5xxlfp16.gguf"]).is_none());
    }

    #[test]
    fn defaults_follow_the_model_and_its_variant() {
        assert_eq!(
            defaults_for(None, &["animagine-xl-4.0-Q8_0.gguf"]).width,
            1024.0
        );
        assert_eq!(
            defaults_for(None, &["v1-5-pruned-emaonly-Q8_0.gguf"]).width,
            512.0
        );
        let z = family_of(&["z_image_turbo"]);
        assert_eq!(defaults_for(z, &["z_image_turbo"]).steps, 8);
    }

    #[test]
    fn every_component_is_pinned_and_has_a_flag() {
        for family in FAMILIES {
            let parts = parts_of(family);
            assert_eq!(
                parts.len(),
                family.parts.len(),
                "{} names a missing component",
                family.id
            );
            for part in parts {
                assert!(is_hex64(part.sha256), "{} {}", family.id, part.role);
                assert!(part.size > 0);
                assert!(!part.role.is_empty());
            }
            assert!(family.defaults.width > 0.0);
        }
    }

    #[test]
    fn edit_by_reference_only_where_the_family_takes_one() {
        assert_eq!(
            reference_mode_of(
                family_of(&["qwen-image-edit-Q4.gguf"]),
                &["qwen-image-edit-Q4.gguf"]
            ),
            "edit"
        );
        assert_eq!(
            reference_mode_of(family_of(&["flux2-klein-4b.gguf"]), &[][..]),
            "edit"
        );
        assert_eq!(
            reference_mode_of(
                family_of(&["flux1-kontext-dev.gguf"]),
                &["flux1-kontext-dev.gguf"]
            ),
            "edit"
        );
        assert_eq!(
            reference_mode_of(family_of(&["qwen-image-2.1-Q4_K_M.gguf"]), &[][..]),
            "img2img"
        );
        assert_eq!(reference_mode_of(None, &["sd-turbo.gguf"]), "img2img");
    }

    #[test]
    fn component_urls_follow_the_repository_path() {
        let vae = component_by_id("flux-vae").expect("flux-vae is a component");
        assert_eq!(
            vae.url(),
            "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors?download=true"
        );
    }
}
