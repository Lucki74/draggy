//! Which stable-diffusion.cpp build a machine runs, and the order it falls back in when one fails to start.
//!
//! The archive table lives here and nowhere else. Windows rows stay on the pin the Windows shell uses; the Linux and
//! macOS rows come from the newer release, since the old pin has no archive for them.

use crate::platform::{Arch, Os};

/// One archive: its name, the published sha256 and its size in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SdArchive {
    pub name: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

/// The archives a runner needs. CUDA on Windows also needs the separate runtime archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SdAssets {
    pub main: SdArchive,
    pub extra: Option<SdArchive>,
}

pub const WINDOWS_RELEASE: &str = "master-898-2bb7294";
pub const UNIX_RELEASE: &str = "master-1028-37bc88b";

const RUNNERS: [&str; 5] = ["cuda", "metal", "rocm", "vulkan", "cpu"];

const fn archive(name: &'static str, sha256: &'static str, size: u64) -> SdArchive {
    SdArchive { name, sha256, size }
}

const WIN_CUDART: SdArchive = archive(
    "cudart-sd-bin-win-cu12-x64.zip",
    "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d",
    563_452_046,
);

fn alone(main: SdArchive) -> Option<SdAssets> {
    Some(SdAssets { main, extra: None })
}

/// The archives for `runner` on this system, or None when none is published. The runner is `cuda`, `rocm`, `vulkan`,
/// `metal` or `cpu`.
pub fn archives_for(os: Os, arch: Arch, runner: &str) -> Option<SdAssets> {
    match (os, arch, runner) {
        (Os::Windows, Arch::X64, "cuda") => Some(SdAssets {
            main: archive(
                "sd-master-2bb7294-bin-win-cuda12-x64.zip",
                "220d2a7e1cd24d8b9c0073e2370c91780e8547cd841d398644fe54543cc5a620",
                333_380_261,
            ),
            extra: Some(WIN_CUDART),
        }),
        (Os::Windows, Arch::X64, "vulkan") => alone(archive(
            "sd-master-2bb7294-bin-win-vulkan-x64.zip",
            "06bd91f712b0b22f2539749d9ae04c089471f8a3be330a49ec88ecfaea7d71b8",
            31_935_877,
        )),
        (Os::Windows, Arch::X64, "rocm") => alone(archive(
            "sd-master-2bb7294-bin-win-rocm-7.14.0-x64.zip",
            "2699a9cbfe3e89c6130e3257347a50136b7b22807881e835abe9c86bc32f6f8e",
            192_108_045,
        )),
        (Os::Windows, Arch::X64, "cpu") => alone(archive(
            "sd-master-2bb7294-bin-win-cpu-x64.zip",
            "ae344e272aabf9be51ce8732ef0d079cbd1a977a58d472c221a633791978e987",
            17_185_807,
        )),
        (Os::Linux, Arch::X64, "rocm") => alone(archive(
            "sd-master-37bc88b-bin-Linux-Ubuntu-24.04-x86_64-rocm-10.1.0.zip",
            "d7812be578515b3c20be0342b82b9f9c7a8b55b7b29e4cc506012418b1761e47",
            297_878_665,
        )),
        (Os::Linux, Arch::X64, "vulkan") => alone(archive(
            "sd-master-37bc88b-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
            "3e84a0c0e87898bc9aeb71bf4adeb08e89b3d1424d1ab018bca4add907721b37",
            37_652_946,
        )),
        (Os::Linux, Arch::X64, "cpu") => alone(archive(
            "sd-master-37bc88b-bin-Linux-Ubuntu-24.04-x86_64.zip",
            "5a7fefd58b4827a8966c08e10390343af52dbfe0f56ef23e171b457affd4b648",
            27_327_954,
        )),
        (Os::MacOs, Arch::Arm64, "metal") => alone(archive(
            "sd-master-37bc88b-bin-Darwin-macOS-26.6.2-arm64.zip",
            "d79e0771c724c265ca11ca313fa87008b1977aa11ea84940e47925f16f64c9c9",
            37_596_065,
        )),
        _ => None,
    }
}

/// The release tag the archives of this system come from.
pub fn release_for(os: Os) -> &'static str {
    if os == Os::Windows {
        WINDOWS_RELEASE
    } else {
        UNIX_RELEASE
    }
}

/// The runners with an archive on this system, most capable first. CUDA needs an NVIDIA driver and ROCm needs the
/// `gpu.rocm` choice. Linux has no CUDA archive, so NVIDIA cards use Vulkan there.
pub fn runners_for(os: Os, arch: Arch, nvidia: bool, rocm: bool) -> Vec<&'static str> {
    RUNNERS
        .into_iter()
        .filter(|runner| match *runner {
            "cuda" => nvidia,
            "rocm" => rocm,
            _ => true,
        })
        .filter(|runner| archives_for(os, arch, runner).is_some())
        .collect()
}

/// The runner to try first: Metal on a Mac, CUDA on NVIDIA, ROCm when chosen, Vulkan on any other GPU, else the CPU
/// build. None when no build is published.
pub fn default_runner(
    os: Os,
    arch: Arch,
    vram_gb: f64,
    nvidia: bool,
    rocm: bool,
) -> Option<&'static str> {
    let available = runners_for(os, arch, nvidia, rocm);
    let has = |name: &str| available.contains(&name);
    if has("metal") {
        Some("metal")
    } else if nvidia && has("cuda") {
        Some("cuda")
    } else if vram_gb > 0.0 && rocm && has("rocm") {
        Some("rocm")
    } else if vram_gb > 0.0 && has("vulkan") {
        Some("vulkan")
    } else if has("cpu") {
        Some("cpu")
    } else {
        available.first().copied()
    }
}

/// The runners to try in turn when one fails to start: the preferred one, then Vulkan, then the CPU. A runner with no
/// archive on this system is left out, and a runner is listed once.
pub fn fallback_order(os: Os, arch: Arch, preferred: &str) -> Vec<&'static str> {
    let mut order: Vec<&'static str> = Vec::new();
    for name in [preferred, "vulkan", "cpu"] {
        let Some(runner) = RUNNERS.into_iter().find(|candidate| *candidate == name) else {
            continue;
        };
        if archives_for(os, arch, runner).is_some() && !order.contains(&runner) {
            order.push(runner);
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_matches_the_pinned_rows() {
        let cuda = archives_for(Os::Windows, Arch::X64, "cuda").unwrap();
        assert_eq!(cuda.main.name, "sd-master-2bb7294-bin-win-cuda12-x64.zip");
        assert_eq!(cuda.extra.unwrap().name, "cudart-sd-bin-win-cu12-x64.zip");
        assert!(archives_for(Os::Windows, Arch::Arm64, "cpu").is_none());
    }

    #[test]
    fn every_digest_is_a_sha256() {
        for os in [Os::Windows, Os::Linux, Os::MacOs] {
            for arch in [Arch::X64, Arch::Arm64] {
                for runner in RUNNERS {
                    let Some(found) = archives_for(os, arch, runner) else {
                        continue;
                    };
                    for archive in [Some(found.main), found.extra].into_iter().flatten() {
                        assert_eq!(archive.sha256.len(), 64, "{}", archive.name);
                        assert!(archive.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
                    }
                }
            }
        }
    }

    #[test]
    fn default_runner_per_platform() {
        let pick = default_runner;
        assert_eq!(pick(Os::MacOs, Arch::Arm64, 16.0, false, false), Some("metal"));
        assert_eq!(pick(Os::Windows, Arch::X64, 12.0, true, false), Some("cuda"));
        assert_eq!(pick(Os::Windows, Arch::X64, 8.0, false, false), Some("vulkan"));
        assert_eq!(pick(Os::Windows, Arch::X64, 8.0, false, true), Some("rocm"));
        assert_eq!(pick(Os::Windows, Arch::X64, 0.0, false, false), Some("cpu"));
        // No Linux CUDA archive: an NVIDIA card falls to Vulkan.
        assert_eq!(pick(Os::Linux, Arch::X64, 12.0, true, false), Some("vulkan"));
        assert_eq!(pick(Os::Linux, Arch::X64, 8.0, false, true), Some("rocm"));
        assert_eq!(pick(Os::Linux, Arch::X64, 0.0, false, false), Some("cpu"));
        assert_eq!(pick(Os::Linux, Arch::Arm64, 8.0, false, false), None);
        assert_eq!(pick(Os::MacOs, Arch::X64, 8.0, false, false), None);
    }

    #[test]
    fn fallback_is_preferred_then_vulkan_then_cpu() {
        assert_eq!(
            fallback_order(Os::Windows, Arch::X64, "cuda"),
            ["cuda", "vulkan", "cpu"]
        );
        assert_eq!(
            fallback_order(Os::Windows, Arch::X64, "vulkan"),
            ["vulkan", "cpu"]
        );
        assert_eq!(
            fallback_order(Os::Linux, Arch::X64, "rocm"),
            ["rocm", "vulkan", "cpu"]
        );
        assert_eq!(fallback_order(Os::Linux, Arch::X64, "cuda"), ["vulkan", "cpu"]);
        assert_eq!(fallback_order(Os::MacOs, Arch::Arm64, "metal"), ["metal"]);
        assert!(fallback_order(Os::Linux, Arch::Arm64, "vulkan").is_empty());
    }

    #[test]
    fn release_tags() {
        assert_eq!(release_for(Os::Windows), WINDOWS_RELEASE);
        assert_eq!(release_for(Os::Linux), UNIX_RELEASE);
    }
}
