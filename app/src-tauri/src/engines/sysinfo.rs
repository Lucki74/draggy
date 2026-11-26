//! Facts about this machine: memory, volume space, the processor and graphics card names.

use std::path::PathBuf;
use std::sync::LazyLock;

use draggy_engine::command::{ProcessRunner, run_text};
use draggy_engine::hardware_probe::{Memory, Space};
use regex::Regex;

#[cfg(windows)]
const DISPLAY_CLASS: &str =
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
#[cfg(windows)]
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
#[cfg(not(windows))]
pub async fn cpu_model() -> String {
    unix::cpu_model()
        .await
        .unwrap_or_else(|| "Unknown CPU".to_owned())
}

/// The processor's marketing name, as `os.cpus()[0].model` reads it.
#[cfg(windows)]
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

/// The graphics card's name: nvidia-smi first, then the display class in the registry.
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
    #[cfg(not(windows))]
    {
        unix::gpu_name().await
    }
    #[cfg(windows)]
    {
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
    unix::memory().unwrap_or(Memory {
        total_bytes: 0,
        free_bytes: 0,
    })
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
pub fn volume_space(root: &str) -> Option<Space> {
    unix::volume_space(root)
}

/// macOS and Linux readers. The parsers build everywhere so their tests run on every runner.
#[cfg_attr(windows, allow(dead_code))]
mod unix {
    use super::{Memory, ProcessRunner, Space, pick_gpu_name, run_text, tidy_name};

    fn command_text(program: &str, args: &[&str]) -> Option<String> {
        let out = std::process::Command::new(program)
            .args(args)
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// A `/proc/meminfo` field in bytes, e.g. `MemTotal:  16314172 kB`.
    pub fn meminfo_bytes(text: &str, field: &str) -> Option<u64> {
        text.lines().find_map(|line| {
            let rest = line.strip_prefix(field)?.strip_prefix(':')?;
            let kib: u64 = rest.split_whitespace().next()?.parse().ok()?;
            Some(kib * 1024)
        })
    }

    /// Free plus inactive and speculative pages from `vm_stat`, which macOS can hand out at once.
    pub fn vm_stat_free_bytes(text: &str) -> Option<u64> {
        let page: u64 = text
            .lines()
            .next()?
            .split("page size of ")
            .nth(1)?
            .split_whitespace()
            .next()?
            .parse()
            .ok()?;
        let pages = |name: &str| -> u64 {
            text.lines()
                .find_map(|line| line.strip_prefix(name))
                .and_then(|rest| rest.trim().trim_end_matches('.').parse().ok())
                .unwrap_or(0)
        };
        Some((pages("Pages free:") + pages("Pages inactive:") + pages("Pages speculative:")) * page)
    }

    /// Size and free bytes from the data line of `df -Pk`.
    pub fn df_space(text: &str) -> Option<Space> {
        let line = text.lines().nth(1)?;
        let fields: Vec<&str> = line.split_whitespace().collect();
        let size: u64 = fields.get(1)?.parse().ok()?;
        let free: u64 = fields.get(3)?.parse().ok()?;
        Some(Space {
            size_bytes: size * 1024,
            free_bytes: free * 1024,
        })
    }

    /// The `model name` line of `/proc/cpuinfo`.
    pub fn cpuinfo_model(text: &str) -> Option<String> {
        text.lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(key, _)| key.trim() == "model name")
            .map(|(_, value)| tidy_name(value.trim()))
            .filter(|name| !name.is_empty())
    }

    /// Display adapters from `lspci`, e.g. `01:00.0 VGA compatible controller: NVIDIA Corporation AD104`.
    pub fn lspci_gpus(text: &str) -> Vec<String> {
        text.lines()
            .filter(|line| {
                [
                    "VGA compatible controller",
                    "3D controller",
                    "Display controller",
                ]
                .iter()
                .any(|kind| line.contains(kind))
            })
            .filter_map(|line| line.splitn(3, ':').nth(2))
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .collect()
    }

    pub fn memory() -> Option<Memory> {
        if cfg!(target_os = "macos") {
            let total = command_text("/usr/sbin/sysctl", &["-n", "hw.memsize"])?
                .trim()
                .parse()
                .ok()?;
            let free = command_text("/usr/bin/vm_stat", &[])
                .as_deref()
                .and_then(vm_stat_free_bytes)
                .unwrap_or(0);
            Some(Memory {
                total_bytes: total,
                free_bytes: free,
            })
        } else {
            let text = std::fs::read_to_string("/proc/meminfo").ok()?;
            Some(Memory {
                total_bytes: meminfo_bytes(&text, "MemTotal")?,
                free_bytes: meminfo_bytes(&text, "MemAvailable")
                    .or_else(|| meminfo_bytes(&text, "MemFree"))
                    .unwrap_or(0),
            })
        }
    }

    pub fn volume_space(root: &str) -> Option<Space> {
        df_space(&command_text("df", &["-Pk", root])?)
    }

    pub async fn cpu_model() -> Option<String> {
        if cfg!(target_os = "macos") {
            run_text(
                &ProcessRunner,
                "/usr/sbin/sysctl",
                &["-n", "machdep.cpu.brand_string"],
                5000,
            )
            .await
            .map(|name| tidy_name(name.trim()))
            .filter(|name| !name.is_empty())
        } else {
            cpuinfo_model(&std::fs::read_to_string("/proc/cpuinfo").ok()?)
        }
    }

    /// Apple silicon shares the chip with the GPU, so the chip name stands for it. Intel Macs and
    /// Linux boxes without lspci report no name.
    pub async fn gpu_name() -> Option<String> {
        if cfg!(target_os = "macos") {
            if !cfg!(target_arch = "aarch64") {
                return None;
            }
            let chip = cpu_model().await.unwrap_or_else(|| "Apple".to_owned());
            Some(format!("{chip} GPU"))
        } else {
            let out = run_text(&ProcessRunner, "lspci", &[], 4000).await?;
            pick_gpu_name(&lspci_gpus(&out))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn meminfo_reads_kib_as_bytes() {
            let text =
                "MemTotal:       16314172 kB\nMemFree:  100 kB\nMemAvailable:    8000000 kB\n";
            assert_eq!(meminfo_bytes(text, "MemTotal"), Some(16_314_172 * 1024));
            assert_eq!(meminfo_bytes(text, "MemAvailable"), Some(8_000_000 * 1024));
            assert_eq!(meminfo_bytes(text, "Mem"), None);
        }

        #[test]
        fn vm_stat_adds_the_reusable_pages() {
            let text = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:      10.\nPages active:    99.\nPages inactive:  5.\nPages speculative: 1.\n";
            assert_eq!(vm_stat_free_bytes(text), Some(16 * 16384));
        }

        #[test]
        fn df_reads_size_and_available() {
            let text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 994662584 500 400000000 50% /\n";
            let space = df_space(text).unwrap();
            assert_eq!(space.size_bytes, 994_662_584 * 1024);
            assert_eq!(space.free_bytes, 400_000_000 * 1024);
        }

        #[test]
        fn cpuinfo_and_lspci_names() {
            let cpu = "processor\t: 0\nmodel name\t: AMD Ryzen 7 7840U w/ Radeon(TM)  780M\n";
            assert_eq!(
                cpuinfo_model(cpu).as_deref(),
                Some("AMD Ryzen 7 7840U w/ Radeon 780M")
            );
            let pci = "00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 620\n00:1f.3 Audio device: Intel\n01:00.0 3D controller: NVIDIA Corporation GA107M\n";
            assert_eq!(
                lspci_gpus(pci),
                vec![
                    "Intel Corporation UHD Graphics 620",
                    "NVIDIA Corporation GA107M"
                ]
            );
        }
    }
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
