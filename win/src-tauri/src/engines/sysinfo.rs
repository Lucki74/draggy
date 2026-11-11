//! Facts about this machine that Electron got from `os` and Chromium: memory, volume space, the processor and graphics
//! card names.

use std::path::PathBuf;
use std::sync::LazyLock;

use draggy_engine::command::{ProcessRunner, run_text};
use draggy_engine::hardware_probe::{Memory, Space};
use regex::Regex;

const DISPLAY_CLASS: &str =
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const CPU_KEY: &str = "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0";

static SOFTWARE_RENDERER: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)basic render|swiftshader|llvmpipe|softpipe|microsoft basic").ok()
});
static TRADEMARK: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)\((TM|R)\)").ok());

/// Adapters that draw without a GPU: naming one of them would describe the machine wrongly.
pub fn is_software_renderer(name: &str) -> bool {
    SOFTWARE_RENDERER
        .as_ref()
        .is_some_and(|re| re.is_match(name))
}

/// A card name without trademark marks or doubled spaces.
pub fn tidy_name(name: &str) -> String {
    let stripped = match TRADEMARK.as_ref() {
        Some(re) => re.replace_all(name, "").into_owned(),
        None => name.to_owned(),
    };
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The value of a `reg query` line for `value`, e.g. `DriverDesc    REG_SZ    NVIDIA GeForce`.
pub fn reg_string_values(out: &str, value: &str) -> Vec<String> {
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix(value)?;
            let (kind, data) = rest.trim_start().split_once(char::is_whitespace)?;
            (kind == "REG_SZ").then(|| data.trim().to_owned())
        })
        .filter(|data| !data.is_empty())
        .collect()
}

/// The first graphics adapter name that is real hardware.
pub fn pick_gpu_name(names: &[String]) -> Option<String> {
    names
        .iter()
        .find(|name| !is_software_renderer(name))
        .map(|name| tidy_name(name))
}

fn system_root() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
}

pub fn reg_exe() -> PathBuf {
    system_root().join("System32").join("reg.exe")
}

/// The processor's marketing name, as `os.cpus()[0].model` reads it.
pub async fn cpu_model() -> String {
    let reg = reg_exe().to_string_lossy().into_owned();
    let out = run_text(
        &ProcessRunner,
        &reg,
        &["query", CPU_KEY, "/v", "ProcessorNameString"],
        5000,
    )
    .await
    .unwrap_or_default();
    reg_string_values(&out, "ProcessorNameString")
        .into_iter()
        .next()
        .unwrap_or_else(|| "Unknown CPU".to_owned())
}

/// The graphics card's name: nvidia-smi first, then the display class in the registry. Chromium's GPU report, which
/// Electron used, has no Tauri counterpart.
pub async fn gpu_name() -> Option<String> {
    let runner = ProcessRunner;
    let nvidia = run_text(
        &runner,
        "nvidia-smi",
        &["--query-gpu=name", "--format=csv,noheader"],
        4000,
    )
    .await;
    if let Some(name) = nvidia
        .as_deref()
        .and_then(|text| text.lines().next())
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        return Some(tidy_name(name));
    }
    let reg = reg_exe().to_string_lossy().into_owned();
    let out = run_text(
        &runner,
        &reg,
        &["query", DISPLAY_CLASS, "/s", "/v", "DriverDesc"],
        8000,
    )
    .await
    .unwrap_or_default();
    pick_gpu_name(&reg_string_values(&out, "DriverDesc"))
}

pub fn logical_cpus() -> usize {
    std::thread::available_parallelism().map_or(1, usize::from)
}

#[cfg(windows)]
pub fn memory() -> Memory {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: the struct is zeroed apart from the length field the API requires, and outlives the call.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) != 0 {
            return Memory {
                total_bytes: status.ullTotalPhys,
                free_bytes: status.ullAvailPhys,
            };
        }
    }
    Memory {
        total_bytes: 0,
        free_bytes: 0,
    }
}

#[cfg(not(windows))]
pub fn memory() -> Memory {
    Memory {
        total_bytes: 0,
        free_bytes: 0,
    }
}

#[cfg(windows)]
pub fn volume_space(root: &str) -> Option<Space> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = std::ffi::OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
    // SAFETY: `wide` is NUL-terminated and the three out pointers are live locals.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    (ok != 0).then_some(Space {
        size_bytes: total,
        free_bytes: free,
    })
}

#[cfg(not(windows))]
pub fn volume_space(_root: &str) -> Option<Space> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_renderers_are_not_named() {
        assert!(is_software_renderer("Microsoft Basic Render Driver"));
        assert!(is_software_renderer("Google SwiftShader"));
        assert!(!is_software_renderer("NVIDIA GeForce RTX 4070"));
    }

    #[test]
    fn names_lose_marks_and_extra_spaces() {
        assert_eq!(
            tidy_name("Intel(R)  UHD Graphics (TM) 770"),
            "Intel UHD Graphics 770"
        );
    }

    #[test]
    fn picks_the_first_real_adapter_from_registry_output() {
        let out = "HKEY_LOCAL_MACHINE\\x\\0000\r\n    DriverDesc    REG_SZ    Microsoft Basic Render Driver\r\n\r\nHKEY\\0001\r\n    DriverDesc    REG_SZ    AMD Radeon(TM) 780M\r\n";
        let names = reg_string_values(out, "DriverDesc");
        assert_eq!(names.len(), 2);
        assert_eq!(pick_gpu_name(&names).as_deref(), Some("AMD Radeon 780M"));
        assert_eq!(pick_gpu_name(&[]), None);
    }
}
