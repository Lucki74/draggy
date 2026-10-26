use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinuxHardwareInfo {
    pub cpu_cores: usize,
    pub ram_gb: usize,
    pub os_name: String,
}

pub fn probe_linux_hardware() -> LinuxHardwareInfo {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    LinuxHardwareInfo {
        cpu_cores: cores,
        ram_gb: 16,
        os_name: "Linux (GTK4)".to_string(),
    }
}
