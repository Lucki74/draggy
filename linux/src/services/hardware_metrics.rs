use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub cpu_count: usize,
}

pub fn sample_metrics() -> SystemMetrics {
    let cpu_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let mut mem_total = 16384;
    let mut mem_available = 8192;

    if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                if let Some(kb) = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse::<u64>().ok())
                {
                    mem_total = kb / 1024;
                }
            } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
                if let Some(kb) = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse::<u64>().ok())
                {
                    mem_available = kb / 1024;
                }
            }
        }
    }

    let mem_used = mem_total.saturating_sub(mem_available);

    SystemMetrics {
        memory_used_mb: mem_used,
        memory_total_mb: mem_total,
        cpu_count,
    }
}
