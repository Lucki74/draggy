//! How many cores the engine should use: performance cores for generation, every physical core for prompts.
//! Port of electron/cpuTopology.cjs.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::command::{CommandRunner, run_text};
use crate::js;
use crate::platform::{Files, Os};

const SYSFS_ROOT: &str = "/sys/devices";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuTopology {
    pub logical: usize,
    pub physical: usize,
    pub performance: usize,
}

/// With SMT on the P-cores only (Intel hybrid) logical minus physical is exactly the P-core count; on a uniform SMT
/// chip it equals the physical count; without SMT there is nothing to tell apart. A physical count of 0 means unknown.
pub fn from_counts(logical: usize, physical: usize) -> CpuTopology {
    let known = if physical == 0 { logical } else { physical };
    let safe_physical = known.min(logical).max(1);
    let smt = logical.saturating_sub(safe_physical);
    let performance = if smt > 0 && smt <= safe_physical {
        smt
    } else {
        safe_physical
    };
    CpuTopology {
        logical,
        physical: safe_physical,
        performance,
    }
}

/// Expands a sysfs CPU list such as "0-7,16,18-19". Pieces that do not read as numbers are skipped.
pub fn parse_cpu_list(text: &str) -> Vec<i64> {
    let mut cpus = Vec::new();
    for part in text.trim().split(',') {
        if part.is_empty() {
            continue;
        }
        let pieces: Vec<&str> = part.split('-').collect();
        let from = pieces.first().copied().unwrap_or("");
        let to = pieces.get(1).copied().unwrap_or(from);
        let (Some(lo), Some(hi)) = (js::parse_int(from), js::parse_int(to)) else {
            continue;
        };
        for cpu in (lo as i64)..=(hi as i64) {
            cpus.push(cpu);
        }
    }
    cpus
}

static CORE_COUNT: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)(?-u:\b)([0-9]+)-Core(?-u:\b)").ok());

static INTEL_HYBRID: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)Intel.*i[79]-(?:1[234][0-9]{2,3})").ok());

/// Reads the core count from a processor's name, with no process started: antivirus blocks a hidden PowerShell.
/// AMD names its core count; Intel 12th-14th gen i7/i9 chips have 8 P-cores.
pub fn windows_topology(model: &str, logical: usize) -> Option<CpuTopology> {
    let core_count = CORE_COUNT
        .as_ref()
        .and_then(|pattern| pattern.captures(model));
    if let Some(captures) = core_count {
        let cores = captures
            .get(1)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(usize::MAX);
        return Some(from_counts(logical, cores));
    }
    let hybrid = INTEL_HYBRID
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(model));
    if hybrid && logical >= 20 {
        return Some(from_counts(logical, logical - 8));
    }
    None
}

/// The file reads of the Linux probe, so tests can give it a folder that is not on disk.
fn cpu_names(files: &dyn Files, cpu_dir: &Path) -> Option<Vec<(i64, String)>> {
    let names = files.list_dir(cpu_dir)?;
    Some(
        names
            .into_iter()
            .filter_map(|name| {
                let digits = name.strip_prefix("cpu")?;
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                Some((digits.parse::<i64>().ok()?, name))
            })
            .collect(),
    )
}

/// Linux exposes the real answer: sibling lists give physical cores, and cpu_core lists Intel P-cores.
pub fn linux_topology(files: &dyn Files, sys_root: &Path) -> Option<CpuTopology> {
    let cpu_dir = sys_root.join("system").join("cpu");
    let Some(names) = cpu_names(files, &cpu_dir) else {
        tracing::warn!(target: "engine.cpu", "cpu sysfs unreadable");
        return None;
    };
    let mut core_of: BTreeMap<i64, String> = BTreeMap::new();
    for (number, name) in names {
        let topology = cpu_dir.join(&name).join("topology");
        let siblings = files
            .read_text(&topology.join("thread_siblings_list"))
            .or_else(|| files.read_text(&topology.join("core_cpus_list")));
        if let Some(siblings) = siblings {
            core_of.insert(number, siblings.trim().to_owned());
        }
    }
    if core_of.is_empty() {
        return None;
    }

    let logical = core_of.len();
    let physical = core_of.values().collect::<BTreeSet<_>>().len();
    if let Some(p_core_list) = files.read_text(&sys_root.join("cpu_core").join("cpus")) {
        let p_cores: BTreeSet<&String> = parse_cpu_list(&p_core_list)
            .iter()
            .filter_map(|cpu| core_of.get(cpu))
            .filter(|siblings| !siblings.is_empty())
            .collect();
        if !p_cores.is_empty() {
            return Some(CpuTopology {
                logical,
                physical,
                performance: p_cores.len(),
            });
        }
    }
    Some(CpuTopology {
        logical,
        physical,
        performance: physical,
    })
}

/// The answer of `sysctl -n <key>` as a number, or None.
async fn sysctl_number(runner: &impl CommandRunner, key: &str) -> Option<f64> {
    let text = run_text(runner, "sysctl", &["-n", key], 4000)
        .await
        .unwrap_or_default();
    js::parse_int(text.trim())
}

/// Apple silicon lists its performance cluster separately; Intel Macs have no perflevels.
pub async fn mac_topology(runner: &impl CommandRunner) -> Option<CpuTopology> {
    let physical = sysctl_number(runner, "hw.physicalcpu")
        .await
        .filter(|n| *n > 0.0)?;
    let logical = sysctl_number(runner, "hw.logicalcpu")
        .await
        .filter(|n| *n > 0.0)
        .unwrap_or(physical);
    let performance = sysctl_number(runner, "hw.perflevel0.physicalcpu")
        .await
        .filter(|n| *n > 0.0)
        .unwrap_or(physical);
    Some(CpuTopology {
        logical: logical as usize,
        physical: physical as usize,
        performance: performance as usize,
    })
}

/// The answer when the probes know nothing: two threads per core, which is right for most desktop chips.
fn fallback(logical: usize) -> CpuTopology {
    let physical = if logical >= 4 {
        logical.div_ceil(2)
    } else {
        logical
    };
    from_counts(logical, physical)
}

/// Finds the topology of this machine. `windows_model` is the processor's name and `logical` the thread count the
/// OS reports; both come in as parameters so the answer can be tested.
pub async fn detect(
    os: Os,
    runner: &impl CommandRunner,
    files: &dyn Files,
    windows_model: &str,
    logical: usize,
) -> CpuTopology {
    let found = match os {
        Os::Windows => windows_topology(windows_model, logical),
        Os::MacOs => mac_topology(runner).await,
        Os::Linux => linux_topology(files, Path::new(SYSFS_ROOT)),
    };
    if let Some(topology) = found {
        return topology;
    }
    let topology = fallback(logical);
    tracing::info!(
        target: "engine.cpu",
        logical = topology.logical,
        physical = topology.physical,
        performance = topology.performance,
        "cpu topology fallback used"
    );
    topology
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hybrid_intel_gives_the_p_core_count() {
        assert_eq!(
            from_counts(32, 24),
            CpuTopology {
                logical: 32,
                physical: 24,
                performance: 8
            }
        );
    }

    #[test]
    fn uniform_chips_use_every_core() {
        assert_eq!(
            from_counts(16, 8),
            CpuTopology {
                logical: 16,
                physical: 8,
                performance: 8
            }
        );
        assert_eq!(
            from_counts(8, 8),
            CpuTopology {
                logical: 8,
                physical: 8,
                performance: 8
            }
        );
    }

    #[test]
    fn zero_physical_means_unknown() {
        assert_eq!(
            from_counts(6, 0),
            CpuTopology {
                logical: 6,
                physical: 6,
                performance: 6
            }
        );
    }

    #[test]
    fn windows_name_gives_the_core_count() {
        let amd = windows_topology("AMD Ryzen 9 7900X3D 12-Core Processor          ", 24)
            .unwrap_or(CpuTopology {
                logical: 0,
                physical: 0,
                performance: 0,
            });
        assert_eq!(amd.physical, 12);
        let intel = windows_topology("13th Gen Intel(R) Core(TM) i7-13700K", 24);
        assert_eq!(intel.map(|t| t.performance), Some(8));
        assert_eq!(windows_topology("Intel(R) Core(TM) i3-10100", 8), None);
        assert_eq!(windows_topology("", 8), None);
    }

    #[test]
    fn cpu_lists_expand_including_single_items() {
        assert_eq!(parse_cpu_list("0-3,8,10-11\n"), vec![0, 1, 2, 3, 8, 10, 11]);
        assert_eq!(parse_cpu_list("5-"), Vec::<i64>::new());
        assert_eq!(parse_cpu_list(""), Vec::<i64>::new());
    }

    #[test]
    fn fallback_pairs_threads_on_small_machines_too() {
        assert_eq!(
            fallback(12),
            CpuTopology {
                logical: 12,
                physical: 6,
                performance: 6
            }
        );
        assert_eq!(
            fallback(2),
            CpuTopology {
                logical: 2,
                physical: 2,
                performance: 2
            }
        );
    }
}
