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
            if line.starts_with("MemTotal:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Ok(kb) = parts[1].parse::<u64>() {
                        mem_total = kb / 1024;
                    }
                }
            } else if line.starts_with("MemAvailable:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Ok(kb) = parts[1].parse::<u64>() {
                        mem_available = kb / 1024;
                    }
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
