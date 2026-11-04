//! Folder access for a container SID. A grant is skipped when the folder already carries it, because applying an
//! inheritable ACE walks the whole tree (2.7 s for a 11,000-file node_modules).

use std::ffi::c_void;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, CONTAINER_INHERIT_ACE,
    DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PSID,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetVolumeInformationW, GetVolumePathNameW, DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE,
};

const ALLOWED_ACE: u8 = 0;
const INHERIT_BOTH: u32 = 3;

pub const READ: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
pub const MODIFY: u32 = READ | FILE_GENERIC_WRITE | DELETE;

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// True on NTFS and ReFS, the only volumes where an ACL can be enforced.
pub fn enforceable(path: &str) -> bool {
    let mut root = [0u16; 261];
    let mut name = [0u16; 32];
    let text = wide(path);
    // SAFETY: the buffers are as long as the lengths passed, and `text` is NUL terminated.
    unsafe {
        if GetVolumePathNameW(text.as_ptr(), root.as_mut_ptr(), root.len() as u32) == 0 {
            return false;
        }
        let queried = GetVolumeInformationW(
            root.as_ptr(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        );
        if queried == 0 {
            return false;
        }
    }
    let end = name.iter().position(|c| *c == 0).unwrap_or(name.len());
    matches!(
        String::from_utf16_lossy(&name[..end]).as_str(),
        "NTFS" | "ReFS"
    )
}

struct Dacl {
    acl: *mut ACL,
    descriptor: *mut c_void,
}

impl Dacl {
    fn read(path: &str) -> Result<Dacl, u32> {
        let text = wide(path);
        let mut acl: *mut ACL = null_mut();
        let mut descriptor: *mut c_void = null_mut();
        // SAFETY: out pointers are valid; the descriptor is freed in Drop.
        let code = unsafe {
            GetNamedSecurityInfoW(
                text.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut acl,
                null_mut(),
                &mut descriptor,
            )
        };
        if code != ERROR_SUCCESS {
            return Err(code);
        }
        Ok(Dacl { acl, descriptor })
    }
}

impl Drop for Dacl {
    fn drop(&mut self) {
        // SAFETY: the descriptor came from GetNamedSecurityInfoW.
        unsafe { LocalFree(self.descriptor) };
    }
}

fn already_granted(dacl: &Dacl, sid: PSID, mask: u32) -> bool {
    if dacl.acl.is_null() {
        return true;
    }
    let both = (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
    // SAFETY: the ACL is valid while `dacl` lives, and each ACE is read inside the count.
    unsafe {
        for index in 0..(*dacl.acl).AceCount as u32 {
            let mut ace: *mut c_void = null_mut();
            if GetAce(dacl.acl, index, &mut ace) == 0 {
                continue;
            }
            let header = ace as *const ACE_HEADER;
            if (*header).AceType != ALLOWED_ACE || (*header).AceFlags & both != both {
                continue;
            }
            let allowed = ace as *const ACCESS_ALLOWED_ACE;
            let other = &(*allowed).SidStart as *const u32 as PSID;
            if EqualSid(other, sid) != 0 && (*allowed).Mask & mask == mask {
                return true;
            }
        }
    }
    false
}

/// Gives `sid` the rights on the folder and everything under it. Returns the Win32 error code on failure.
pub fn allow(path: &str, sid: PSID, mask: u32) -> Result<(), u32> {
    let current = Dacl::read(path)?;
    if already_granted(&current, sid, mask) {
        return Ok(());
    }
    // SAFETY: zeroed EXPLICIT_ACCESS_W is a valid empty value; the SID outlives the call.
    unsafe {
        let mut access: EXPLICIT_ACCESS_W = std::mem::zeroed();
        access.grfAccessPermissions = mask;
        access.grfAccessMode = GRANT_ACCESS;
        access.grfInheritance = INHERIT_BOTH;
        access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        access.Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN;
        access.Trustee.ptstrName = sid as *mut u16;
        let mut merged: *mut ACL = null_mut();
        let code = SetEntriesInAclW(1, &access, current.acl, &mut merged);
        if code != ERROR_SUCCESS {
            return Err(code);
        }
        let text = wide(path);
        let code = SetNamedSecurityInfoW(
            text.as_ptr() as *mut u16,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            merged,
            null(),
        );
        LocalFree(merged as *mut c_void);
        if code != ERROR_SUCCESS {
            return Err(code);
        }
    }
    Ok(())
}
