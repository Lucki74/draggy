use super::hardware_probe::probe_linux_hardware;

pub fn generate_bundle() -> String {
    let info = probe_linux_hardware();
    format!(
        "Linux Diagnostics Bundle\nOS: {}\nCores: {}\nRAM: {} GB",
        info.os_name, info.cpu_cores, info.ram_gb
    )
}
