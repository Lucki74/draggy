//! What this computer can offer a model larger than its memory: RAM, VRAM, drives and how fast each one reads.
//! The benchmark writes a temporary file, and only when the user starts it. Port of electron/hardwareProbe.cjs.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::command::{CommandRunner, run_text};
use crate::cpu_topology::CpuTopology;
use crate::js;
use crate::platform::Os;
use draggy_tools::spawn::CancelToken;

pub const CACHE_FILE: &str = "disk-bench.json";
pub const CACHE_MAX_AGE_MS: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;
const BLOCK: u64 = 16 * 1024 * 1024;
const SECTOR: u64 = 4096;
const REG_TIMEOUT_MS: u64 = 5000;
const SAC_KEY: &str = r"HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy";
const MOUNTED_KEY: &str = r"HKLM\SYSTEM\MountedDevices";
const DISK_ENUM_KEY: &str = r"HKLM\SYSTEM\CurrentControlSet\Services\disk\Enum";

static MOUNTED_LINE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"^\s*\\DosDevices\\([A-Za-z]):\s+REG_BINARY\s+([0-9A-Fa-f]+)\s*$").ok()
});
static DISK_LINE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^\s*([0-9]+)\s+REG_SZ\s+(.+?)\s*$").ok());
static CDROM_OR_FLOPPY: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)cdrom|floppy").ok());
static USBSTOR_PATH: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)usbstor").ok());
static USBSTOR_INSTANCE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)^USBSTOR\\").ok());
static NVME_INSTANCE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)Ven_NVMe|^NVME\\").ok());
static SATA_INSTANCE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)^(SCSI|IDE)\\").ok());
static PRODUCT_NAME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)Prod_([^&\\]+)").ok());
static SMART_APP_CONTROL: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x([0-9a-f]+)").ok()
});

fn matches(pattern: &LazyLock<Option<Regex>>, text: &str) -> bool {
    pattern.as_ref().is_some_and(|re| re.is_match(text))
}

/// A disk the registry lists, with the bus it hangs off and its model name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiskEntry {
    pub index: u64,
    pub bus: &'static str,
    pub name: String,
    pub instance: String,
}

/// Free and total bytes of a volume root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Space {
    pub size_bytes: u64,
    pub free_bytes: u64,
}

/// Looks up the space of a volume root. None when it cannot be read.
pub trait VolumeSpace: Sync {
    fn space(&self, volume: &str) -> Option<Space>;
}

impl<F> VolumeSpace for F
where
    F: Fn(&str) -> Option<Space> + Sync,
{
    fn space(&self, volume: &str) -> Option<Space> {
        self(volume)
    }
}

/// Decodes hex as far as it has whole byte pairs, as `Buffer.from(hex, "hex")` does.
fn decode_hex(text: &str) -> Vec<u8> {
    text.as_bytes()
        .chunks_exact(2)
        .filter_map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|p| u8::from_str_radix(p, 16).ok())
        })
        .collect()
}

/// Reads the local volume letters from `reg query MountedDevices`, with whether each sits on USB storage.
/// Optical and floppy drives are skipped. Order is the order of first appearance, as a JavaScript Map keeps it.
pub fn parse_mounted_devices(text: &str) -> Vec<(char, bool)> {
    let mut letters: Vec<(char, bool)> = Vec::new();
    let Some(line_pattern) = MOUNTED_LINE.as_ref() else {
        return letters;
    };
    for line in text.lines() {
        let Some(captures) = line_pattern.captures(line) else {
            continue;
        };
        let bytes = decode_hex(captures.get(2).map_or("", |m| m.as_str()));
        // A device path is UTF-16 text starting with \?? ; a fixed disk is a partition id.
        let device_path = if bytes.len() > 8 && bytes[0] == 0x5f && bytes[1] == 0 {
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        } else {
            String::new()
        };
        if matches(&CDROM_OR_FLOPPY, &device_path) {
            continue;
        }
        let letter = captures
            .get(1)
            .and_then(|m| m.as_str().chars().next())
            .map_or('?', |c| c.to_ascii_uppercase());
        let usb = matches(&USBSTOR_PATH, &device_path);
        match letters.iter_mut().find(|(known, _)| *known == letter) {
            Some(entry) => entry.1 = usb,
            None => letters.push((letter, usb)),
        }
    }
    letters
}

/// The disks from `reg query Services\disk\Enum`: "0  REG_SZ  SCSI\Disk&Ven_NVMe&Prod_SAMSUNG_MZVL21T0\4&...".
pub fn parse_disk_enum(text: &str) -> Vec<DiskEntry> {
    let mut disks = Vec::new();
    let Some(line_pattern) = DISK_LINE.as_ref() else {
        return disks;
    };
    for line in text.lines() {
        let Some(captures) = line_pattern.captures(line) else {
            continue;
        };
        let instance = captures.get(2).map_or("", |m| m.as_str()).to_owned();
        let bus = if matches(&USBSTOR_INSTANCE, &instance) {
            "usb"
        } else if matches(&NVME_INSTANCE, &instance) {
            "nvme"
        } else if matches(&SATA_INSTANCE, &instance) {
            "sata"
        } else {
            "unknown"
        };
        let name = PRODUCT_NAME
            .as_ref()
            .and_then(|re| re.captures(&instance))
            .and_then(|c| c.get(1))
            .map_or(String::new(), |m| {
                m.as_str().replace('_', " ").trim().to_owned()
            });
        let index = captures
            .get(1)
            .and_then(|m| m.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        disks.push(DiskEntry {
            index,
            bus,
            name,
            instance,
        });
    }
    disks
}

/// Where a model may live: USB drives disconnect, SATA works but is slow.
pub fn bus_role(bus: &str) -> &'static str {
    match bus {
        "nvme" => "good",
        "sata" => "slow",
        "usb" => "refuse",
        _ => "unknown",
    }
}

/// One volume, joined to what is known of its disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub volume: String,
    pub disk_id: Option<String>,
    pub disk_key: String,
    pub name: String,
    pub bus: String,
    pub role: String,
    pub size_bytes: u64,
    pub free_bytes: u64,
}

/// Joins the volume letters to the disks. A volume is tied to its disk only when the computer has one internal disk.
pub fn build_drives(
    letters: &[(char, bool)],
    disks: &[DiskEntry],
    space: &dyn VolumeSpace,
) -> Vec<Drive> {
    let internal: Vec<&DiskEntry> = disks.iter().filter(|disk| disk.bus != "usb").collect();
    let mut buses: Vec<&str> = internal.iter().map(|disk| disk.bus).collect();
    buses.sort_unstable();
    buses.dedup();
    let internal_bus = if buses.len() == 1 {
        buses[0]
    } else {
        "unknown"
    };
    let single = if internal.len() == 1 {
        Some(internal[0])
    } else {
        None
    };

    let mut sorted: Vec<(char, bool)> = letters.to_vec();
    sorted.sort_by_key(|(letter, _)| *letter);
    sorted
        .into_iter()
        .map(|(letter, usb)| {
            let volume = format!("{letter}:\\");
            let bus = if usb { "usb" } else { internal_bus };
            let disk = if usb { None } else { single };
            let found = space.space(&volume).unwrap_or_default();
            Drive {
                volume,
                disk_id: disk.map(|d| d.index.to_string()),
                disk_key: disk.map_or_else(
                    || format!("volume:{letter}"),
                    |d| format!("disk:{}", d.instance),
                ),
                name: disk.map_or_else(String::new, |d| d.name.clone()),
                bus: bus.to_owned(),
                role: bus_role(bus).to_owned(),
                size_bytes: found.size_bytes,
                free_bytes: found.free_bytes,
            }
        })
        .collect()
}

/// Two volumes known to be on one physical disk share its bandwidth, so they are no help as a mirror of each other.
pub fn same_disk(a: &Drive, b: &Drive) -> bool {
    matches!((&a.disk_id, &b.disk_id), (Some(x), Some(y)) if x == y)
}

/// The Smart App Control state from `reg query`: 0 is off, 1 is on, 2 is evaluation mode.
pub fn parse_smart_app_control(text: &str) -> &'static str {
    let Some(captures) = SMART_APP_CONTROL.as_ref().and_then(|re| re.captures(text)) else {
        return "unknown";
    };
    let hex = captures
        .get(1)
        .map_or("", |m| m.as_str())
        .trim_start_matches('0');
    match hex {
        "" | "0" => "off",
        "1" => "on",
        "2" => "evaluation",
        _ => "unknown",
    }
}

/// The numbers a benchmark run measured, already in the units the cache and the UI use.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct BenchSummary {
    #[serde(rename = "seqMBps")]
    pub seq_mbps: f64,
    #[serde(rename = "expertMBps")]
    pub expert_mbps: f64,
    #[serde(rename = "rand4kMBps")]
    pub rand_4k_mbps: f64,
    #[serde(rename = "rand4kIops")]
    pub rand_4k_iops: f64,
    pub unbuffered: bool,
}

/// Raw timings of a run, before they become rates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Timings {
    pub seq_bytes: f64,
    pub seq_ms: f64,
    pub rand_bytes: f64,
    pub rand_ms: f64,
    pub small_reads: f64,
    pub small_ms: f64,
    pub unbuffered: bool,
}

/// MB/s from bytes and elapsed milliseconds.
fn rate(bytes: f64, ms: f64) -> f64 {
    if ms > 0.0 {
        bytes / 1e6 / (ms / 1000.0)
    } else {
        0.0
    }
}

/// Turns the timings of a run into the rates the cache holds.
pub fn summarize(timings: Timings) -> BenchSummary {
    BenchSummary {
        seq_mbps: js::round(rate(timings.seq_bytes, timings.seq_ms)),
        expert_mbps: js::round(rate(timings.rand_bytes, timings.rand_ms)),
        rand_4k_mbps: js::to_fixed1(rate(timings.small_reads * SECTOR as f64, timings.small_ms)),
        rand_4k_iops: if timings.small_ms > 0.0 {
            js::round(timings.small_reads / (timings.small_ms / 1000.0))
        } else {
            0.0
        },
        unbuffered: timings.unbuffered,
    }
}

/// Whether a cached benchmark is younger than thirty days and not from the future. `at` is None for a missing or bad stamp.
pub fn is_fresh(at: Option<f64>, now: f64) -> bool {
    match at {
        Some(at) if at.is_finite() => now - at >= 0.0 && now - at < CACHE_MAX_AGE_MS,
        _ => false,
    }
}

/// The cache file as a map from disk key to entry. A missing or unreadable file starts empty.
pub fn read_cache(file: &Path) -> Map<String, Value> {
    match fs::read_to_string(file) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        },
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(target: "engine.bench", kind = ?error.kind(), "benchmark cache unreadable, starting empty");
            }
            Map::new()
        }
    }
}

/// Writes the cache. A cache that cannot be written only means the test runs again.
pub fn write_cache(file: &Path, cache: &Map<String, Value>) {
    let text = serde_json::to_string_pretty(cache).unwrap_or_default();
    let result = file
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(file, text));
    if let Err(error) = result {
        tracing::warn!(target: "engine.bench", kind = ?error.kind(), "benchmark cache not written, test runs again next time");
    }
}

/// The cached benchmarks that are still fresh at `now`.
pub fn fresh_benchmarks(cache: &Map<String, Value>, now: f64) -> Map<String, Value> {
    cache
        .iter()
        .filter(|(_, entry)| is_fresh(entry.get("at").and_then(Value::as_f64), now))
        .map(|(key, entry)| (key.clone(), entry.clone()))
        .collect()
}

/// Physical memory as the OS reports it, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Memory {
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// What the GPU and processor are called and how much memory the GPU has, from the video probe and CPU name.
#[derive(Debug, Clone, PartialEq)]
pub struct HardwareSpecs {
    pub cpu: Option<String>,
    pub gpu: Option<String>,
    pub vram_gb: f64,
    pub unified_memory: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamReport {
    #[serde(rename = "totalGB")]
    pub total_gb: f64,
    #[serde(rename = "availableGB")]
    pub available_gb: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuReport {
    pub name: Option<String>,
    #[serde(rename = "vramGB")]
    pub vram_gb: f64,
    pub unified: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveReport {
    #[serde(flatten)]
    pub drive: Drive,
    pub benchmark: Option<Value>,
}

/// Everything the planner reads about the machine.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareReport {
    pub ram: RamReport,
    pub gpu: GpuReport,
    pub cpu: CpuReport,
    pub drives: Vec<DriveReport>,
    pub smart_app_control: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuReport {
    pub model: Option<String>,
    pub logical: usize,
    pub physical: usize,
    pub performance: usize,
}

/// The root of a path as Node's `path.parse(p).root` gives it: "/" on POSIX, "C:\" on Windows.
fn root_of(home: &str) -> String {
    if home.starts_with('/') {
        return "/".to_owned();
    }
    let bytes = home.as_bytes();
    if bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        return home[..3].to_owned();
    }
    String::new()
}

/// A finished or refused benchmark run.
#[derive(Debug, Clone, PartialEq)]
pub enum BenchRun {
    Done { disk_key: String, benchmark: Value },
    Refused(&'static str),
    Cancelled,
    Failed(String),
}

/// What a benchmark run writes and measures: the file, the clock and randomness, and where progress goes.
pub struct BenchContext<'a> {
    pub now: &'a dyn Fn() -> f64,
    pub random: &'a dyn Fn() -> f64,
    pub progress: &'a dyn Fn(Progress),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub phase: &'static str,
    pub done: u64,
    pub total: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BenchError {
    #[error("cancelled")]
    Cancelled,
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

/// Writes and reads the temporary file of a benchmark. Real code uses [`FileBench`]; tests use a fake.
pub trait Bench: Sync {
    fn write_temp(&self, file: &Path, size: u64, cancel: &CancelToken) -> Result<(), BenchError>;
    fn measure(
        &self,
        file: &Path,
        size: u64,
        cancel: &CancelToken,
        ctx: &BenchContext<'_>,
    ) -> Result<BenchSummary, BenchError>;
}

/// Reads the file the way the engines read experts: 16 MB blocks in order, 16 MB blocks at random offsets, and 4 KB
/// reads one at a time. Buffered only: the no-cache flag is not used, so `unbuffered` is always false.
#[derive(Debug, Clone, Copy, Default)]
pub struct FileBench;

fn check_cancel(cancel: &CancelToken) -> Result<(), BenchError> {
    if cancel.is_cancelled() {
        Err(BenchError::Cancelled)
    } else {
        Ok(())
    }
}

fn read_at(file: &mut File, buffer: &mut [u8], offset: u64) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(buffer)
}

impl Bench for FileBench {
    fn write_temp(&self, file: &Path, size: u64, cancel: &CancelToken) -> Result<(), BenchError> {
        let mut out = File::create(file)?;
        let block = vec![0x5a_u8; BLOCK as usize];
        let mut offset = 0;
        while offset < size {
            check_cancel(cancel)?;
            let len = (size - offset).min(BLOCK) as usize;
            out.write_all(&block[..len])?;
            offset += len as u64;
        }
        out.sync_all()?;
        Ok(())
    }

    fn measure(
        &self,
        file: &Path,
        size: u64,
        cancel: &CancelToken,
        ctx: &BenchContext<'_>,
    ) -> Result<BenchSummary, BenchError> {
        let mut handle = File::open(file)?;
        let blocks = size / BLOCK;
        let mut buffer = vec![0u8; BLOCK as usize];

        let mut started = (ctx.now)();
        for i in 0..blocks {
            check_cancel(cancel)?;
            read_at(&mut handle, &mut buffer, i * BLOCK)?;
            if i % 8 == 0 {
                (ctx.progress)(Progress {
                    phase: "sequential",
                    done: i,
                    total: blocks,
                });
            }
        }
        let seq_ms = (ctx.now)() - started;

        let random_reads = blocks.min(64);
        started = (ctx.now)();
        for done in 0..random_reads {
            check_cancel(cancel)?;
            let slot = ((ctx.random)() * blocks as f64).floor() as u64;
            read_at(&mut handle, &mut buffer, slot * BLOCK)?;
            if done % 4 == 0 {
                (ctx.progress)(Progress {
                    phase: "random",
                    done,
                    total: random_reads,
                });
            }
        }
        let rand_ms = (ctx.now)() - started;

        let small_reads = 2000_u64;
        let mut small = vec![0u8; SECTOR as usize];
        let slots = size / SECTOR;
        started = (ctx.now)();
        for i in 0..small_reads {
            if i % 200 == 0 {
                check_cancel(cancel)?;
            }
            let slot = ((ctx.random)() * slots as f64).floor() as u64;
            read_at(&mut handle, &mut small, slot * SECTOR)?;
        }
        let small_ms = (ctx.now)() - started;

        Ok(summarize(Timings {
            seq_bytes: (blocks * BLOCK) as f64,
            seq_ms,
            rand_bytes: (random_reads * BLOCK) as f64,
            rand_ms,
            small_reads: small_reads as f64,
            small_ms,
            unbuffered: false,
        }))
    }
}

/// The record a finished benchmark leaves in the cache.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchEntry {
    #[serde(flatten)]
    pub summary: BenchSummary,
    pub at: f64,
    pub volume: String,
    #[serde(rename = "sizeGB")]
    pub size_gb: f64,
}

/// Probes the machine and runs the disk benchmark. The running benchmark is held here so a second run is refused.
pub struct HardwareProbe<'a, R: CommandRunner, V: VolumeSpace> {
    os: Os,
    home: String,
    reg: PathBuf,
    user_data: PathBuf,
    runner: &'a R,
    volumes: &'a V,
    running: Mutex<Option<CancelToken>>,
}

impl<'a, R: CommandRunner, V: VolumeSpace> HardwareProbe<'a, R, V> {
    /// `reg` is the path to reg.exe, `home` the user's home folder and `user_data` the folder the cache lives in.
    pub fn new(
        os: Os,
        home: &str,
        reg: PathBuf,
        user_data: &Path,
        runner: &'a R,
        volumes: &'a V,
    ) -> Self {
        Self {
            os,
            home: home.to_owned(),
            reg,
            user_data: user_data.to_path_buf(),
            runner,
            volumes,
            running: Mutex::new(None),
        }
    }

    fn cache_file(&self) -> PathBuf {
        self.user_data.join(CACHE_FILE)
    }

    async fn reg_query(&self, args: &[&str]) -> String {
        let program = self.reg.to_string_lossy().into_owned();
        run_text(self.runner, &program, args, REG_TIMEOUT_MS)
            .await
            .unwrap_or_default()
    }

    /// The local volumes. Windows reads the registry; elsewhere it is the root of the home folder.
    pub async fn drives(&self) -> Vec<Drive> {
        if self.os != Os::Windows {
            let root = root_of(&self.home);
            return match self.volumes.space(&self.home) {
                Some(found) => vec![Drive {
                    volume: root,
                    disk_id: None,
                    disk_key: "root".to_owned(),
                    name: String::new(),
                    bus: "unknown".to_owned(),
                    role: "unknown".to_owned(),
                    size_bytes: found.size_bytes,
                    free_bytes: found.free_bytes,
                }],
                None => Vec::new(),
            };
        }
        let mounted = self.reg_query(&["query", MOUNTED_KEY]).await;
        let enumerated = self.reg_query(&["query", DISK_ENUM_KEY]).await;
        build_drives(
            &parse_mounted_devices(&mounted),
            &parse_disk_enum(&enumerated),
            self.volumes,
        )
    }

    /// The Smart App Control state. Only Windows has one.
    pub async fn smart_app_control(&self) -> &'static str {
        if self.os != Os::Windows {
            return "unknown";
        }
        parse_smart_app_control(
            &self
                .reg_query(&["query", SAC_KEY, "/v", "VerifiedAndReputablePolicyState"])
                .await,
        )
    }

    /// The cached benchmarks that are still fresh at `now`.
    pub fn benchmarks(&self, now: f64) -> Map<String, Value> {
        fresh_benchmarks(&read_cache(&self.cache_file()), now)
    }

    /// Everything the planner reads. The drives carry their cached benchmark when one is fresh.
    pub async fn probe(
        &self,
        specs: Option<&HardwareSpecs>,
        memory: Memory,
        cpu: CpuTopology,
        now: f64,
    ) -> HardwareReport {
        let list = self.drives().await;
        let sac = self.smart_app_control().await;
        let cached = self.benchmarks(now);
        let gb = |bytes: u64| js::to_fixed1(bytes as f64 / 1024_f64.powi(3));
        HardwareReport {
            ram: RamReport {
                total_gb: gb(memory.total_bytes),
                available_gb: gb(memory.free_bytes),
            },
            gpu: GpuReport {
                name: specs
                    .and_then(|s| s.gpu.clone())
                    .filter(|name| !name.is_empty()),
                vram_gb: specs.map_or(0.0, |s| s.vram_gb),
                unified: specs.is_some_and(|s| s.unified_memory),
            },
            cpu: CpuReport {
                model: specs
                    .and_then(|s| s.cpu.clone())
                    .filter(|model| !model.is_empty()),
                logical: cpu.logical,
                physical: cpu.physical,
                performance: cpu.performance,
            },
            drives: list
                .into_iter()
                .map(|drive| {
                    let benchmark = cached.get(&drive.disk_key).cloned();
                    DriveReport { drive, benchmark }
                })
                .collect(),
            smart_app_control: sac,
        }
    }

    /// Benchmarks the disk behind `volume`. Refuses a second run and a volume without room for the temporary file.
    /// `tag` names the temporary file, so two processes do not share one.
    pub async fn run_benchmark<B: Bench>(
        &self,
        bench: &B,
        volume: &str,
        size_gb: f64,
        tag: &str,
        ctx: &BenchContext<'_>,
    ) -> BenchRun {
        if self.is_running() {
            return BenchRun::Refused("busy");
        }
        let list = self.drives().await;
        let Some(drive) = list
            .iter()
            .find(|d| d.volume.to_lowercase() == volume.to_lowercase())
        else {
            return BenchRun::Refused("unknown-volume");
        };
        let size = (size_gb * 1024_f64.powi(3)).floor() as u64;
        if (drive.free_bytes as f64) < size as f64 * 1.5 {
            return BenchRun::Refused("no-space");
        }
        let cancel = CancelToken::new();
        if !self.begin(cancel.clone()) {
            return BenchRun::Refused("busy");
        }
        let file = PathBuf::from(&drive.volume).join(format!(".draggy-bench-{tag}.tmp"));
        let outcome = bench
            .write_temp(&file, size, &cancel)
            .and_then(|()| bench.measure(&file, size, &cancel, ctx));
        self.end();
        if let Err(error) = fs::remove_file(&file)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(target: "engine.bench", kind = ?error.kind(), "temp file not removed");
        }
        match outcome {
            Ok(summary) => self.record(drive, size_gb, summary, (ctx.now)()),
            Err(BenchError::Cancelled) => {
                tracing::info!(target: "engine.bench", "disk benchmark cancelled");
                BenchRun::Cancelled
            }
            Err(BenchError::Io(error)) => {
                tracing::warn!(target: "engine.bench", kind = ?error.kind(), "disk benchmark failed");
                BenchRun::Failed(error.to_string())
            }
        }
    }

    fn record(&self, drive: &Drive, size_gb: f64, summary: BenchSummary, at: f64) -> BenchRun {
        let entry = BenchEntry {
            summary,
            at,
            volume: drive.volume.clone(),
            size_gb,
        };
        let benchmark = serde_json::to_value(&entry).unwrap_or(Value::Null);
        let mut cache = read_cache(&self.cache_file());
        cache.insert(drive.disk_key.clone(), benchmark.clone());
        write_cache(&self.cache_file(), &cache);
        tracing::info!(
            target: "engine.bench",
            expert_mbps = summary.expert_mbps,
            rand_4k_iops = summary.rand_4k_iops,
            unbuffered = summary.unbuffered,
            "disk benchmark done"
        );
        BenchRun::Done {
            disk_key: drive.disk_key.clone(),
            benchmark,
        }
    }

    /// Stops the running benchmark. True when there was one.
    pub fn cancel_benchmark(&self) -> bool {
        let guard = self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.as_ref() {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    fn is_running(&self) -> bool {
        self.running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }

    fn begin(&self, token: CancelToken) -> bool {
        let mut guard = self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_some() {
            return false;
        }
        *guard = Some(token);
        true
    }

    fn end(&self) {
        *self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounted_devices_keep_local_volumes_and_mark_usb() {
        // Windows stores a device path with "_??_" in place of "\??\", which is what the reference checks for.
        let usb_path = "_??_USBSTOR#Disk&Ven_SanDisk#0001#{53f56307}";
        let fixed = "\\??\\Volume{6f2b}";
        let encode = |text: &str| {
            text.encode_utf16()
                .flat_map(u16::to_le_bytes)
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        };
        let text = format!(
            "HKEY\n    \\DosDevices\\C:    REG_BINARY    {}\n    \\DosDevices\\E:    REG_BINARY    {}\n    \\DosDevices\\D:    REG_BINARY    {}\n    \\DosDevices\\F:    REG_BINARY    {}\n",
            encode(fixed),
            encode(usb_path),
            "0102030405060708090a",
            encode("_??_CDROM0_Floppy"),
        );
        assert_eq!(
            parse_mounted_devices(&text),
            vec![('C', false), ('E', true), ('D', false)]
        );
        assert!(parse_mounted_devices("ERROR: Access is denied.").is_empty());
    }

    #[test]
    fn disk_enum_reads_bus_and_model() {
        let text = "    0    REG_SZ    SCSI\\Disk&Ven_NVMe&Prod_SAMSUNG_MZVL21T0\\4&abc\n    2    REG_SZ    USBSTOR\\Disk&Ven_SanDisk&Prod_USB_Flash_Drive\\0001\n    3    REG_SZ    IDE\\DiskX\\1\n";
        let disks = parse_disk_enum(text);
        let got: Vec<(u64, &str, &str)> = disks
            .iter()
            .map(|d| (d.index, d.bus, d.name.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                (0, "nvme", "SAMSUNG MZVL21T0"),
                (2, "usb", "USB Flash Drive"),
                (3, "sata", "")
            ]
        );
    }

    #[test]
    fn a_volume_is_tied_to_its_disk_only_with_one_internal_disk() {
        let disks = vec![DiskEntry {
            index: 0,
            bus: "nvme",
            name: "Micron".to_owned(),
            instance: "a".to_owned(),
        }];
        let space = |_: &str| {
            Some(Space {
                size_bytes: 10,
                free_bytes: 5,
            })
        };
        let drives = build_drives(&[('C', false), ('D', false), ('E', true)], &disks, &space);
        assert_eq!(drives[0].disk_id.as_deref(), Some("0"));
        assert_eq!(drives[0].name, "Micron");
        assert_eq!(drives[2].disk_id, None);
        assert!(same_disk(&drives[0], &drives[1]));
        assert_eq!(drives[2].role, "refuse");
    }

    #[test]
    fn smart_app_control_reads_off_on_and_evaluation() {
        let out = |n: &str| format!("\nVerifiedAndReputablePolicyState    REG_DWORD    0x{n}\n");
        let states: Vec<&str> = ["0", "1", "2", "7"]
            .iter()
            .map(|n| parse_smart_app_control(&out(n)))
            .collect();
        assert_eq!(states, vec!["off", "on", "evaluation", "unknown"]);
        assert_eq!(parse_smart_app_control("ERROR"), "unknown");
    }

    #[test]
    fn summary_turns_bytes_and_time_into_rates() {
        let result = summarize(Timings {
            seq_bytes: 4e9,
            seq_ms: 1000.0,
            rand_bytes: 1e9,
            rand_ms: 500.0,
            small_reads: 2000.0,
            small_ms: 400.0,
            unbuffered: true,
        });
        assert_eq!(
            result,
            BenchSummary {
                seq_mbps: 4000.0,
                expert_mbps: 2000.0,
                rand_4k_mbps: 20.5,
                rand_4k_iops: 5000.0,
                unbuffered: true
            }
        );
        let zero = summarize(Timings {
            seq_bytes: 1.0,
            seq_ms: 0.0,
            rand_bytes: 1.0,
            rand_ms: 0.0,
            small_reads: 1.0,
            small_ms: 0.0,
            unbuffered: false,
        });
        assert_eq!(zero.seq_mbps, 0.0);
    }

    #[test]
    fn a_benchmark_expires_after_thirty_days() {
        assert!(is_fresh(Some(1000.0), 1000.0 + CACHE_MAX_AGE_MS - 1.0));
        assert!(!is_fresh(Some(1000.0), 1000.0 + CACHE_MAX_AGE_MS));
        assert!(!is_fresh(None, 5.0));
        assert!(!is_fresh(Some(f64::NAN), 5.0));
    }

    #[test]
    fn a_missing_cache_reads_empty() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(read_cache(&dir.path().join(CACHE_FILE)).is_empty());
    }

    #[test]
    fn the_real_measurement_reads_a_temp_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("bench.tmp");
        let size = 64 * 1024 * 1024;
        let cancel = CancelToken::new();
        FileBench.write_temp(&file, size, &cancel).expect("write");
        let state = std::cell::Cell::new(0.0_f64);
        let clock = std::cell::Cell::new(0.0_f64);
        let now = || {
            clock.set(clock.get() + 1.0);
            clock.get()
        };
        let random = || {
            let next = (state.get() + 0.618_033_988).fract();
            state.set(next);
            next
        };
        let progress = |_: Progress| {};
        let ctx = BenchContext {
            now: &now,
            random: &random,
            progress: &progress,
        };
        let summary = FileBench
            .measure(&file, size, &cancel, &ctx)
            .expect("measure");
        assert!(summary.seq_mbps > 0.0);
        assert!(summary.rand_4k_iops > 0.0);
        assert!(!summary.unbuffered);
    }

    #[test]
    fn a_cancelled_write_stops_and_leaves_no_cache() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("cancel.tmp");
        let cancel = CancelToken::new();
        cancel.cancel();
        let result = FileBench.write_temp(&file, BLOCK * 2, &cancel);
        assert!(matches!(result, Err(BenchError::Cancelled)));
    }

    #[test]
    fn the_root_of_a_home_folder() {
        assert_eq!(root_of("/home/user"), "/");
        assert_eq!(root_of("C:\\Users\\me"), "C:\\");
        assert_eq!(root_of("relative"), "");
    }
}
