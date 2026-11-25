//! The drives a model may be written to. Only fixed and removable drives are listed; the planner refuses removable ones.

use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drive {
    pub volume: PathBuf,
    pub free_bytes: u64,
    pub removable: bool,
}

#[cfg(windows)]
const DRIVE_REMOVABLE: u32 = 2;
#[cfg(windows)]
const DRIVE_FIXED: u32 = 3;

/// Every mounted fixed or removable drive with its free space. Network, optical and RAM drives are left out.
#[cfg(windows)]
pub fn drives() -> Vec<Drive> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives,
    };

    // SAFETY: GetLogicalDrives takes no pointers and only reads the drive bitmask.
    let mask = unsafe { GetLogicalDrives() };
    let mut found = Vec::new();
    for bit in 0..26u32 {
        if mask & (1 << bit) == 0 {
            continue;
        }
        let letter = char::from(b'A' + bit as u8);
        let root: Vec<u16> = format!("{letter}:\\")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: `root` is NUL terminated and outlives the call.
        let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
        let removable = match kind {
            DRIVE_FIXED => false,
            DRIVE_REMOVABLE => true,
            _ => continue,
        };
        let mut free: u64 = 0;
        // SAFETY: `root` is NUL terminated; `free` is a live u64 and the other out pointers are allowed to be null.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                root.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            continue;
        }
        found.push(Drive {
            volume: PathBuf::from(format!("{letter}:\\")),
            free_bytes: free,
            removable,
        });
    }
    found
}

#[cfg(not(windows))]
pub fn drives() -> Vec<Drive> {
    Vec::new()
}
