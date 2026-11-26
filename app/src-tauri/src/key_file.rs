//! The AES key for `secrets.bin` on systems without DPAPI, with no system keystore involved.
//! A random secret lives in `secrets.key` next to `secrets.bin`, readable by the user only. The AES key is
//! the SHA-256 of that secret and the machine's id, so a copy of the data folder opens on no other machine.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const FILE: &str = "secrets.key";
const SECRET_LEN: usize = 32;
const CONTEXT: &[u8] = b"draggy secrets.bin key v1";

/// The 32-byte key for `user_data`, creating `secrets.key` on first use.
#[cfg_attr(windows, allow(dead_code))]
pub fn load_or_create(user_data: &Path) -> Result<Zeroizing<[u8; 32]>, String> {
    load_or_create_for(user_data, &machine_id()?)
}

/// The key for `user_data` on the machine named `machine`.
pub fn load_or_create_for(user_data: &Path, machine: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let secret = read_or_create_secret(user_data)?;
    Ok(derive(&secret, machine))
}

/// The key from the stored secret and the machine id.
pub fn derive(secret: &[u8], machine: &str) -> Zeroizing<[u8; 32]> {
    let mut hash = Sha256::new();
    hash.update(CONTEXT);
    hash.update((machine.len() as u64).to_be_bytes());
    hash.update(machine.as_bytes());
    hash.update(secret);
    Zeroizing::new(hash.finalize().into())
}

fn read_or_create_secret(user_data: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    let path = user_data.join(FILE);
    match fs::read(&path) {
        Ok(bytes) if bytes.len() == SECRET_LEN => return Ok(Zeroizing::new(bytes)),
        // Never replace a damaged secret: what secrets.bin holds would be lost with it.
        Ok(_) => return Err(format!("{FILE} is damaged")),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("{FILE} could not be read: {}", error.kind())),
    }
    fs::create_dir_all(user_data).map_err(|e| format!("data folder: {}", e.kind()))?;
    let mut secret = Zeroizing::new(vec![0u8; SECRET_LEN]);
    getrandom::fill(&mut secret).map_err(|_| "no random source".to_owned())?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(&secret)
                .and_then(|()| file.sync_all())
                .map_err(|e| format!("{FILE} could not be written: {}", e.kind()))?;
            Ok(secret)
        }
        // Another start wrote it first: use that one.
        Err(error) if error.kind() == ErrorKind::AlreadyExists => read_or_create_secret(user_data),
        Err(error) => Err(format!("{FILE} could not be created: {}", error.kind())),
    }
}

/// The hardware UUID that macOS gives every Mac.
#[cfg(target_os = "macos")]
fn machine_id() -> Result<String, String> {
    let output = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|e| format!("ioreg could not run: {}", e.kind()))?;
    platform_uuid(&String::from_utf8_lossy(&output.stdout))
        .ok_or_else(|| "this Mac reports no hardware UUID".to_owned())
}

/// The id systemd or D-Bus writes once per install.
#[cfg(target_os = "linux")]
fn machine_id() -> Result<String, String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| linux_machine_id(&std::fs::read_to_string(path).ok()?))
        .ok_or_else(|| "this system has no machine id".to_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
#[cfg_attr(windows, allow(dead_code))]
fn machine_id() -> Result<String, String> {
    Err("Saving keys is not available on this system yet".to_owned())
}

/// A machine-id file's value: 32 hex digits on one line.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_machine_id(text: &str) -> Option<String> {
    let id = text.trim();
    (id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())).then(|| id.to_ascii_lowercase())
}

/// The value of `"IOPlatformUUID" = "..."` in ioreg's output.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn platform_uuid(ioreg: &str) -> Option<String> {
    ioreg.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("\"IOPlatformUUID\"")?;
        let value = rest
            .trim_start()
            .strip_prefix('=')?
            .trim()
            .trim_matches('"');
        (!value.is_empty()).then(|| value.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_depends_on_both_the_secret_and_the_machine() {
        let secret = [7u8; 32];
        let key = derive(&secret, "machine-a");
        assert_eq!(*key, *derive(&secret, "machine-a"));
        assert_ne!(*key, *derive(&secret, "machine-b"));
        assert_ne!(*key, *derive(&[8u8; 32], "machine-a"));
    }

    #[test]
    fn the_secret_is_made_once_and_then_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = read_or_create_secret(dir.path()).expect("create");
        let again = read_or_create_secret(dir.path()).expect("read");
        assert_eq!(first.len(), SECRET_LEN);
        assert_eq!(*first, *again);
    }

    #[cfg(unix)]
    #[test]
    fn only_the_user_can_read_the_secret() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        read_or_create_secret(dir.path()).expect("create");
        let mode = fs::metadata(dir.path().join(FILE))
            .expect("meta")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_damaged_secret_is_refused_and_left_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(FILE), b"short").expect("write");
        assert!(read_or_create_secret(dir.path()).is_err());
        assert_eq!(fs::read(dir.path().join(FILE)).expect("read"), b"short");
    }

    #[test]
    fn reads_the_linux_machine_id() {
        assert_eq!(
            linux_machine_id("4C4C4544004A3910804CB4C04F394E32\n").as_deref(),
            Some("4c4c4544004a3910804cb4c04f394e32")
        );
        assert_eq!(linux_machine_id(""), None);
        assert_eq!(linux_machine_id("uninitialized\n"), None);
    }

    #[test]
    fn reads_the_uuid_from_ioreg_output() {
        let ioreg = "+-o J316sAP  <class IOPlatformExpertDevice>\n    {\n      \"IOPlatformSerialNumber\" = \"X\"\n      \"IOPlatformUUID\" = \"0A1B2C3D-0000-1111-2222-333344445555\"\n    }\n";
        assert_eq!(
            platform_uuid(ioreg).as_deref(),
            Some("0A1B2C3D-0000-1111-2222-333344445555")
        );
        assert_eq!(platform_uuid("nothing here"), None);
    }
}
