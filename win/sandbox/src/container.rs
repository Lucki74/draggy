//! Starts the command in the container. The container has no capabilities unless the spec turns the network on, so
//! it cannot reach the network, the user profile or any folder it was not granted.

use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{GetLastError, LocalFree, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{FreeSid, PSID, SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, ResumeThread, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
    STARTUPINFOEXW,
};

use crate::grant::{self, wide};
use crate::spec::Spec;

const ATTRIBUTE_SECURITY_CAPABILITIES: usize = 0x0002_0009;
const GROUP_ENABLED: u32 = 4;
const USE_STD_HANDLES: u32 = 0x100;
const EXIT_VOLUME: i32 = 70;
const EXIT_PROFILE: i32 = 71;
const EXIT_GRANT: i32 = 72;
const EXIT_START: i32 = 73;
const EXIT_JOB: i32 = 74;
/// internetClient, internetClientServer, privateNetworkClientServer.
const NETWORK_CAPABILITIES: [&str; 3] = ["S-1-15-3-1", "S-1-15-3-2", "S-1-15-3-3"];

pub fn run(spec: &Spec) -> i32 {
    let sid = match prepare(spec) {
        Ok(sid) => sid,
        Err(code) => return code,
    };
    let code = start(spec, sid);
    // SAFETY: the SID came from the profile calls in `prepare`.
    unsafe { FreeSid(sid) };
    code
}

/// Grants the spec's folders and starts nothing. A first grant on a big project can take minutes.
pub fn grant_only(spec: &Spec) -> i32 {
    match prepare(spec) {
        Ok(sid) => {
            // SAFETY: the SID came from the profile calls in `prepare`.
            unsafe { FreeSid(sid) };
            0
        }
        Err(code) => code,
    }
}

fn prepare(spec: &Spec) -> Result<PSID, i32> {
    for folder in spec
        .read_only
        .iter()
        .chain(&spec.read_write)
        .chain(Some(&spec.cwd))
    {
        if !grant::enforceable(folder) {
            eprintln!(
                "sandbox: {folder} is not on an NTFS or ReFS volume, so it cannot be isolated"
            );
            return Err(EXIT_VOLUME);
        }
    }
    let name = wide(&format!("dg.{}", spec.identity));
    let mut sid: PSID = null_mut();
    // SAFETY: `name` is NUL terminated and `sid` receives an allocated SID.
    unsafe {
        let code = CreateAppContainerProfile(
            name.as_ptr(),
            name.as_ptr(),
            name.as_ptr(),
            null(),
            0,
            &mut sid,
        );
        if code != 0 {
            // The profile already exists from an earlier run, so derive its SID instead.
            let derived = DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid);
            if derived != 0 {
                eprintln!("sandbox: cannot create the container ({code:#x})");
                return Err(EXIT_PROFILE);
            }
        }
    }
    for (folders, mask) in [
        (&spec.read_only, grant::READ),
        (&spec.read_write, grant::MODIFY),
    ] {
        for folder in folders {
            if let Err(code) = grant::allow(folder, sid, mask) {
                // A toolchain folder the user cannot change is left as is; the project itself must be granted.
                if mask == grant::MODIFY {
                    eprintln!("sandbox: cannot grant access to {folder} (error {code})");
                    // SAFETY: the SID came from the profile calls above.
                    unsafe { FreeSid(sid) };
                    return Err(EXIT_GRANT);
                }
                eprintln!("sandbox: warning: no access granted to {folder} (error {code})");
            }
        }
    }
    Ok(sid)
}

fn start(spec: &Spec, sid: PSID) -> i32 {
    let mut capabilities: Vec<SID_AND_ATTRIBUTES> = Vec::new();
    if spec.network {
        for text in NETWORK_CAPABILITIES {
            let mut capability: PSID = null_mut();
            let text = wide(text);
            // SAFETY: the string is NUL terminated; each SID is freed with LocalFree after the process starts.
            unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut capability) };
            capabilities.push(SID_AND_ATTRIBUTES {
                Sid: capability,
                Attributes: GROUP_ENABLED,
            });
        }
    }
    let security = SECURITY_CAPABILITIES {
        AppContainerSid: sid,
        Capabilities: if capabilities.is_empty() {
            null_mut()
        } else {
            capabilities.as_mut_ptr()
        },
        CapabilityCount: capabilities.len() as u32,
        Reserved: 0,
    };
    let mut env = spec.env.clone();
    // CreateProcess fails with error 203 for a container unless LOCALAPPDATA is set.
    if !env
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("LOCALAPPDATA"))
    {
        if let Ok(value) = std::env::var("LOCALAPPDATA") {
            env.push(("LOCALAPPDATA".into(), value));
        }
    }
    let environment = env_block(&env);
    let cwd = wide(&spec.cwd);
    let mut line = wide(&spec.command_line);

    // SAFETY: every pointer handed to the Win32 calls stays alive until the process is created.
    unsafe {
        let mut size = 0usize;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
        let mut storage = vec![0u8; size];
        let list = storage.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        let ready = InitializeProcThreadAttributeList(list, 1, 0, &mut size) != 0
            && UpdateProcThreadAttribute(
                list,
                0,
                ATTRIBUTE_SECURITY_CAPABILITIES,
                &security as *const _ as *const _,
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                null_mut(),
                null(),
            ) != 0;
        if !ready {
            eprintln!(
                "sandbox: cannot set the container attributes (error {})",
                GetLastError()
            );
            return EXIT_START;
        }
        let mut startup: STARTUPINFOEXW = std::mem::zeroed();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = USE_STD_HANDLES;
        startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        startup.lpAttributeList = list;
        let mut info: PROCESS_INFORMATION = std::mem::zeroed();
        let flags = EXTENDED_STARTUPINFO_PRESENT
            | CREATE_SUSPENDED
            | CREATE_UNICODE_ENVIRONMENT
            | CREATE_NO_WINDOW;
        let created = CreateProcessW(
            null(),
            line.as_mut_ptr(),
            null(),
            null(),
            1,
            flags,
            environment.as_ptr() as *const _,
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        );
        let failure = GetLastError();
        DeleteProcThreadAttributeList(list);
        for capability in &capabilities {
            LocalFree(capability.Sid);
        }
        if created == 0 {
            eprintln!("sandbox: cannot start the command (error {failure})");
            return EXIT_START;
        }
        let job = CreateJobObjectW(null(), null());
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let bound = !job.is_null()
            && SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) != 0
            && AssignProcessToJobObject(job, info.hProcess) != 0;
        if !bound {
            // Without the Job object a killed launcher would leave the command running, so it never starts.
            TerminateProcess(info.hProcess, 1);
            eprintln!(
                "sandbox: cannot bind the command to a job (error {})",
                GetLastError()
            );
            return EXIT_JOB;
        }
        ResumeThread(info.hThread);
        let waited = WaitForSingleObject(info.hProcess as HANDLE, INFINITE);
        let mut code = 0u32;
        if waited == WAIT_OBJECT_0 {
            GetExitCodeProcess(info.hProcess, &mut code);
        }
        code as i32
    }
}

/// A UTF-16 environment block holding only the variables in the spec, sorted as Windows expects.
fn env_block(env: &[(String, String)]) -> Vec<u16> {
    let mut pairs: Vec<&(String, String)> = env
        .iter()
        .filter(|(name, _)| !name.is_empty() && !name.contains('='))
        .collect();
    pairs.sort_by_key(|(name, _)| name.to_ascii_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (name, value) in pairs {
        block.extend(format!("{name}={value}").encode_utf16());
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_env_block_is_sorted_and_double_terminated() {
        let block = env_block(&[("b".into(), "2".into()), ("A".into(), "1".into())]);
        assert_eq!(String::from_utf16_lossy(&block), "A=1\0b=2\0\0");
    }

    #[test]
    fn an_empty_env_is_still_a_valid_block() {
        assert_eq!(env_block(&[]), vec![0, 0]);
    }
}
