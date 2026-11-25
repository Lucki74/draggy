//! `--diagnose`: runs this launcher again inside the container and reports what the container token can reach on
//! the way down to the working folder. Dev tooling only; it changes nothing but the profile and one read grant on
//! the launcher's own folder, which the child needs to start.

use std::path::Path;
use std::ptr::{null, null_mut};

use serde_json::{json, Value};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{
    GetTokenInformation, LookupPrivilegeNameW, TokenAppContainerSid, TokenPrivileges,
    LUID_AND_ATTRIBUTES, TOKEN_APPCONTAINER_INFORMATION, TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FindClose, FindFirstFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE,
    OPEN_EXISTING, WIN32_FIND_DATAW,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::container;
use crate::grant::wide;
use crate::spec::Spec;

const SE_PRIVILEGE_ENABLED: u32 = 2;

/// Parent side: starts the child in the container, which prints one JSON document to the shared stdout.
pub fn run(spec: &Spec) -> i32 {
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("sandbox: cannot find the launcher");
        return 64;
    };
    let mut read_only = spec.read_only.clone();
    read_only.extend(exe.parent().map(|folder| folder.display().to_string()));
    let child = Spec {
        identity: spec.identity.clone(),
        cwd: spec.cwd.clone(),
        read_only,
        read_write: spec.read_write.clone(),
        network: spec.network,
        env: spec.env.clone(),
        command_line: format!("\"{}\" --diagnose-child", exe.display()),
    };
    container::run(&child)
}

/// Child side, inside the container: its working folder is the one under test.
pub fn child() -> i32 {
    let Ok(cwd) = std::env::current_dir() else {
        println!("{}", json!({ "error": "no current directory" }));
        return 1;
    };
    let cwd = cwd.display().to_string();
    let paths: Vec<Value> = ancestors(&cwd).iter().map(|path| probe(path)).collect();
    let star = format!("{}\\*", cwd.trim_end_matches('\\'));
    println!(
        "{}",
        json!({
            "sid": token_sid(),
            "changeNotify": privilege("SeChangeNotifyPrivilege"),
            "cwd": cwd,
            "paths": paths,
            "findFirst": { "cwd": find_first(&cwd), "cwdStar": find_first(&star) },
        })
    );
    0
}

/// The folder and every parent up to the volume root, deepest first.
fn ancestors(cwd: &str) -> Vec<String> {
    Path::new(cwd)
        .ancestors()
        .map(|path| path.display().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

fn probe(path: &str) -> Value {
    let mut access = serde_json::Map::new();
    for (name, mask) in [
        ("list", FILE_LIST_DIRECTORY),
        ("readAttributes", FILE_READ_ATTRIBUTES),
        ("traverse", FILE_TRAVERSE),
    ] {
        access.insert(name.into(), open(path, mask));
    }
    json!({ "path": path, "access": access })
}

/// "ok", or the Win32 error code.
fn open(path: &str, access: u32) -> Value {
    let name = wide(path);
    // SAFETY: `name` is NUL terminated; the handle is closed right away.
    unsafe {
        let handle = CreateFileW(
            name.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            return json!(GetLastError());
        }
        CloseHandle(handle);
    }
    json!("ok")
}

fn find_first(pattern: &str) -> Value {
    let name = wide(pattern);
    // SAFETY: `name` is NUL terminated and `data` is a plain output struct.
    unsafe {
        let mut data: WIN32_FIND_DATAW = std::mem::zeroed();
        let handle = FindFirstFileW(name.as_ptr(), &mut data);
        if handle == INVALID_HANDLE_VALUE {
            return json!(GetLastError());
        }
        FindClose(handle);
    }
    json!("ok")
}

/// Reads one token class into a buffer sized by a first call.
fn token_info(class: i32) -> Option<Vec<u8>> {
    // SAFETY: standard two-call size query; the token handle is closed before returning.
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut size = 0u32;
        GetTokenInformation(token, class, null_mut(), 0, &mut size);
        let mut buffer = vec![0u8; size as usize];
        let ok = GetTokenInformation(token, class, buffer.as_mut_ptr() as *mut _, size, &mut size);
        CloseHandle(token);
        (ok != 0).then_some(buffer)
    }
}

fn token_sid() -> Value {
    let Some(buffer) = token_info(TokenAppContainerSid) else {
        return Value::Null;
    };
    // SAFETY: the buffer holds a TOKEN_APPCONTAINER_INFORMATION whose SID points inside it.
    unsafe {
        let info = &*(buffer.as_ptr() as *const TOKEN_APPCONTAINER_INFORMATION);
        let mut text = null_mut();
        if info.TokenAppContainer.is_null()
            || ConvertSidToStringSidW(info.TokenAppContainer, &mut text) == 0
        {
            return Value::Null;
        }
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text as *mut _);
        json!(sid)
    }
}

/// Whether the token holds the privilege, and whether it is enabled.
fn privilege(wanted: &str) -> Value {
    let Some(buffer) = token_info(TokenPrivileges) else {
        return Value::Null;
    };
    // SAFETY: the buffer holds a TOKEN_PRIVILEGES followed by `PrivilegeCount` entries.
    unsafe {
        let privileges = &*(buffer.as_ptr() as *const TOKEN_PRIVILEGES);
        let entries: &[LUID_AND_ATTRIBUTES] = std::slice::from_raw_parts(
            privileges.Privileges.as_ptr(),
            privileges.PrivilegeCount as usize,
        );
        for entry in entries {
            let mut name = [0u16; 128];
            let mut len = name.len() as u32;
            if LookupPrivilegeNameW(null(), &entry.Luid, name.as_mut_ptr(), &mut len) != 0
                && String::from_utf16_lossy(&name[..len as usize]) == wanted
            {
                let enabled = entry.Attributes & SE_PRIVILEGE_ENABLED != 0;
                return json!({ "present": true, "enabled": enabled });
            }
        }
    }
    json!({ "present": false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ancestors_run_from_the_folder_up_to_the_root() {
        assert_eq!(
            ancestors(r"C:\Users\me\Documents"),
            [
                r"C:\Users\me\Documents",
                r"C:\Users\me",
                r"C:\Users",
                r"C:\"
            ]
        );
    }

    #[test]
    fn a_root_has_only_itself() {
        assert_eq!(ancestors(r"E:\"), [r"E:\"]);
    }
}
