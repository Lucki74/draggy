//! A Windows job that every child Draggy starts joins. Windows closes the job's handle when Draggy's process ends,
//! however it ends, and the job then ends the children, so a crash or a kill from Task Manager leaves no
//! llama-server, sd-server or shell running.

#[cfg(windows)]
pub fn install() {
    use std::sync::OnceLock;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
    use windows::core::PCWSTR;

    static JOB: OnceLock<Option<usize>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        let raw = *JOB.get_or_init(|| {
            // SAFETY: the job handle is created here and kept open for the life of the process on purpose, since
            // closing it is what ends the children. The limits struct lives for the call.
            unsafe {
                let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(limits).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set.is_err() {
                    let _ = CloseHandle(job);
                    return None;
                }
                Some(job.0 as usize)
            }
        });
        raw.map(|raw| HANDLE(raw as *mut _))
    }

    fn adopt(pid: u32) {
        let Some(job) = job() else { return };
        // SAFETY: the process handle is opened, used and closed here. Joining is best effort.
        unsafe {
            let Ok(process) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) else {
                return;
            };
            let _ = AssignProcessToJobObject(job, process);
            let _ = CloseHandle(process);
        }
    }

    draggy_tools::spawn::set_adopter(adopt);
}

#[cfg(not(windows))]
pub fn install() {}
