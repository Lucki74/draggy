//! How much graphics memory this computer has, asked of each vendor's tool and of the OS. Port of
//! `detectVideoMemoryGB` and `parseNvidiaInfo` in electron/platform.cjs.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::command::{CommandRunner, run_text};
use crate::js;
use crate::platform::{Arch, Files, Os};

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const DISPLAY_CLASS: &str =
    r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
const DRM_ROOT: &str = "/sys/class/drm";

static QWORD: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)REG_QWORD\s+0x([0-9a-f]+)").ok());
static PROFILER_SIZE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)([0-9.]+)\s*(GB|MB)").ok());
static ROCM_TOTAL: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)Total\s*\(?B\)?[^0-9]*([0-9]+)").ok());
static CARD: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"^card[0-9]+$").ok());

/// The biggest REG_QWORD in `reg query` output, in bytes; 0 when there is none.
pub fn largest_qword(text: &str) -> f64 {
    let Some(pattern) = QWORD.as_ref() else {
        return 0.0;
    };
    pattern
        .captures_iter(text)
        .filter_map(|captures| captures.get(1))
        .map(|hex| {
            hex.as_str()
                .bytes()
                .fold(0.0_f64, |acc, byte| acc * 16.0 + f64::from(hex_digit(byte)))
        })
        .fold(0.0, f64::max)
}

fn hex_digit(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

/// The first line of `nvidia-smi --query-gpu=memory.total`, in GB. None when it names no positive amount.
pub fn parse_nvidia_smi_memory(text: &str) -> Option<f64> {
    let first = text.trim().split('\n').next().unwrap_or("");
    let mib = js::parse_int(first)?;
    (mib > 0.0).then_some(mib / 1024.0)
}

/// The GPU's compute capability and driver version from `nvidia-smi`.
#[derive(Debug, Clone, PartialEq)]
pub struct NvidiaInfo {
    pub compute_capability: f64,
    pub driver_version: String,
    pub driver_major: u64,
}

/// Reads "8.9, 580.12" from the first GPU. None unless both numbers are positive.
pub fn parse_nvidia_info(text: &str) -> Option<NvidiaInfo> {
    let first = text.trim().split('\n').next().unwrap_or("");
    let mut parts = first.split(',').map(str::trim);
    let capability = js::parse_float(parts.next().unwrap_or(""))?;
    let driver = parts.next()?;
    let driver_major = js::parse_int(driver)?;
    if !(capability > 0.0 && driver_major > 0.0) {
        return None;
    }
    Some(NvidiaInfo {
        compute_capability: capability,
        driver_version: driver.to_owned(),
        driver_major: driver_major as u64,
    })
}

/// The memory a Mac lets the GPU use. The wired limit when the OS sets one, else three quarters of RAM above 36 GB.
pub fn apple_silicon_budget_gb(wired_limit_mb: Option<&str>, total_bytes: u64) -> f64 {
    if let Some(limit) = wired_limit_mb.and_then(|text| js::parse_int(text.trim()))
        && limit > 0.0
    {
        return limit / 1024.0;
    }
    let total_gb = total_bytes as f64 / GIB;
    if total_gb > 36.0 {
        total_gb * 0.75
    } else {
        total_gb * 0.67
    }
}

/// The largest GPU memory in `system_profiler -json SPDisplaysDataType`, in GB. 0 for anything that does not parse.
pub fn parse_system_profiler(text: &str) -> f64 {
    let Ok(parsed) = serde_json::from_str::<Value>(text) else {
        return 0.0;
    };
    let Some(displays) = parsed.get("SPDisplaysDataType").and_then(Value::as_array) else {
        return 0.0;
    };
    let Some(pattern) = PROFILER_SIZE.as_ref() else {
        return 0.0;
    };
    let mut best = 0.0_f64;
    for entry in displays {
        let raw = ["spdisplays_vram", "spdisplays_vram_shared"]
            .iter()
            .filter_map(|key| entry.get(*key).and_then(Value::as_str))
            .find(|value| !value.is_empty());
        let Some(captures) = raw.and_then(|text| pattern.captures(text)) else {
            continue;
        };
        let amount = captures.get(1).and_then(|m| js::parse_float(m.as_str()));
        let unit = captures.get(2).map_or("", |m| m.as_str());
        let Some(amount) = amount else {
            continue;
        };
        let value = if unit.eq_ignore_ascii_case("GB") {
            amount
        } else {
            amount / 1024.0
        };
        if value > best {
            best = value;
        }
    }
    best
}

/// `rocm-smi --showmeminfo vram`: the total in bytes, in GB. None when the line is missing.
pub fn parse_rocm_memory(text: &str) -> Option<f64> {
    let captures = ROCM_TOTAL.as_ref()?.captures(text)?;
    let bytes = js::parse_int(captures.get(1)?.as_str())?;
    Some(bytes / GIB)
}

/// The AMD card memory the kernel exposes in sysfs, in GB. The largest card wins; 0 when none can be read.
fn linux_amd_vram(files: &dyn Files) -> f64 {
    let Some(names) = files.list_dir(Path::new(DRM_ROOT)) else {
        return 0.0;
    };
    let Some(card) = CARD.as_ref() else {
        return 0.0;
    };
    let mut best = 0.0_f64;
    for name in names.iter().filter(|name| card.is_match(name)) {
        let file = PathBuf::from(DRM_ROOT)
            .join(name)
            .join("device")
            .join("mem_info_vram_total");
        if !files.exists(&file) {
            continue;
        }
        let Some(text) = files.read_text(&file) else {
            return 0.0;
        };
        if let Some(bytes) = js::parse_int(text.trim()) {
            best = best.max(bytes / GIB);
        }
    }
    best
}

/// The host facts the video probe needs. `system_root` is where reg.exe lives on Windows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoHost {
    pub os: Os,
    pub arch: Arch,
    pub total_memory_bytes: u64,
    pub system_root: PathBuf,
}

/// The GPU memory in GB. Each vendor tool is asked in turn; anything that cannot answer leaves the next to try.
pub async fn detect_video_memory_gb(
    host: &VideoHost,
    runner: &impl CommandRunner,
    files: &dyn Files,
) -> f64 {
    let nvidia = run_text(
        runner,
        "nvidia-smi",
        &["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
        4000,
    )
    .await;
    if let Some(gb) = nvidia.as_deref().and_then(parse_nvidia_smi_memory) {
        return gb;
    }

    match host.os {
        Os::Windows => {
            // reg.exe, not PowerShell: antivirus heuristics block a hidden PowerShell started by an app.
            let reg = host.system_root.join("System32").join("reg.exe");
            let program = reg.to_string_lossy().into_owned();
            let out = run_text(
                runner,
                &program,
                &[
                    "query",
                    DISPLAY_CLASS,
                    "/s",
                    "/v",
                    "HardwareInformation.qwMemorySize",
                ],
                8000,
            )
            .await;
            largest_qword(out.as_deref().unwrap_or("")) / GIB
        }
        Os::MacOs => mac_video_memory(host, runner).await,
        Os::Linux => {
            let amd = linux_amd_vram(files);
            if amd > 0.0 {
                return amd;
            }
            let rocm = run_text(runner, "rocm-smi", &["--showmeminfo", "vram"], 4000).await;
            rocm.as_deref().and_then(parse_rocm_memory).unwrap_or(0.0)
        }
    }
}

async fn mac_video_memory(host: &VideoHost, runner: &impl CommandRunner) -> f64 {
    if host.arch == Arch::Arm64 {
        let wired = run_text(runner, "sysctl", &["-n", "iogpu.wired_limit_mb"], 4000).await;
        return apple_silicon_budget_gb(wired.as_deref(), host.total_memory_bytes);
    }
    let out = run_text(
        runner,
        "system_profiler",
        &["-json", "SPDisplaysDataType"],
        8000,
    )
    .await;
    out.as_deref().map_or(0.0, parse_system_profiler)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn largest_qword_takes_the_biggest_value() {
        let text = "    HardwareInformation.qwMemorySize    REG_QWORD    0x200000000\n    other    REG_QWORD    0x100000000\n";
        assert_eq!(largest_qword(text), 8589934592.0);
        assert_eq!(largest_qword("ERROR: not found"), 0.0);
    }

    #[test]
    fn nvidia_smi_reads_the_first_card_in_mib() {
        assert_eq!(parse_nvidia_smi_memory("8192\n4096\n"), Some(8.0));
        assert_eq!(parse_nvidia_smi_memory("0\n"), None);
        assert_eq!(parse_nvidia_smi_memory(""), None);
    }

    #[test]
    fn nvidia_info_needs_capability_and_driver() {
        let info = parse_nvidia_info("8.9, 580.12\n").expect("info");
        assert_eq!(info.compute_capability, 8.9);
        assert_eq!(info.driver_version, "580.12");
        assert_eq!(info.driver_major, 580);
        assert_eq!(parse_nvidia_info("garbage"), None);
    }

    #[test]
    fn apple_budget_uses_the_wired_limit_or_a_share_of_ram() {
        assert_eq!(
            apple_silicon_budget_gb(Some("8192\n"), 16 * 1024 * 1024 * 1024),
            8.0
        );
        assert_eq!(
            apple_silicon_budget_gb(Some("0"), 48 * 1024 * 1024 * 1024),
            36.0
        );
        assert!((apple_silicon_budget_gb(None, 16 * 1024 * 1024 * 1024) - 10.72).abs() < 1e-9);
    }

    #[test]
    fn system_profiler_takes_the_largest_card() {
        let json = r#"{"SPDisplaysDataType":[{"spdisplays_vram":"8 GB"},{"spdisplays_vram_shared":"512 MB"},{"spdisplays_vram":"1536 MB"}]}"#;
        assert_eq!(parse_system_profiler(json), 8.0);
        assert_eq!(parse_system_profiler("not json"), 0.0);
    }

    #[test]
    fn rocm_reads_the_total_in_bytes() {
        let text = "GPU[0]\t\tTotal (B): 17163091968\n";
        assert!((parse_rocm_memory(text).unwrap_or(0.0) - 15.984).abs() < 0.001);
        assert_eq!(parse_rocm_memory("nothing"), None);
        // TS quirk: the reference pattern needs "Total" followed by "(B)" or "B", so the "Total Memory (B)" wording reads as no answer.
        assert_eq!(
            parse_rocm_memory("GPU[0]\t\tVRAM Total Memory (B): 17163091968\n"),
            None
        );
    }
}
