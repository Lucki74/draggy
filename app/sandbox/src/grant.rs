//! Folder access for a container SID. A grant is skipped when the folder already carries it, because applying an
//! inheritable ACE walks the whole tree (2.7 s for a 11,000-file node_modules).

use std::ffi::c_void;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_INVALID_SID, ERROR_SUCCESS};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
    EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
};
use windows_sys::Win32::Security::{
    DeriveCapabilitySidsFromName, EqualSid, GetAce, GetSecurityDescriptorControl,
    InitializeSecurityDescriptor, SetFileSecurityW, SetSecurityDescriptorControl,
    SetSecurityDescriptorDacl, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, CONTAINER_INHERIT_ACE,
    DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PSID, SECURITY_DESCRIPTOR,
    SE_DACL_AUTO_INHERITED, SE_DACL_PROTECTED,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetVolumeInformationW, GetVolumePathNameW, DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_TRAVERSE, SYNCHRONIZE,
};

const ALLOWED_ACE: u8 = 0;
const INHERIT_BOTH: u32 = 3;

pub const READ: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
pub const MODIFY: u32 = READ | FILE_GENERIC_WRITE | DELETE;
/// Lists a folder's names without reading any file in it. cmd's `dir`, PowerShell and .NET look a folder up
/// through its parent, so the project's parent needs this much.
pub const LIST: u32 = FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

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

/// True when the DACL already gives `sid` at least `mask`, through an ACE that children inherit when `inherited`
/// is set, or through any ACE otherwise.
fn already_granted(dacl: &Dacl, sid: PSID, mask: u32, inherited: bool) -> bool {
    if dacl.acl.is_null() {
        return true;
    }
    let both = if inherited {
        (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8
    } else {
        0
    };
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

/// True when containers may already read and run files in the folder, through ALL APPLICATION PACKAGES or `extra`.
pub fn containers_can_read(path: &str, extra: Option<PSID>) -> bool {
    let Ok(current) = Dacl::read(path) else {
        return false;
    };
    if extra.is_some_and(|sid| already_granted(&current, sid, READ, false)) {
        return true;
    }
    let text = wide("S-1-15-2-1");
    let mut any_package: PSID = null_mut();
    // SAFETY: the string is NUL terminated; the SID is freed with LocalFree below.
    if unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut any_package) } == 0 {
        return false;
    }
    let readable = already_granted(&current, any_package, READ, false);
    // SAFETY: the SID came from ConvertStringSidToSidW.
    unsafe { LocalFree(any_package) };
    readable
}

/// Gives `sid` the rights on the folder and everything under it. Returns the Win32 error code on failure.
pub fn allow(path: &str, sid: PSID, mask: u32) -> Result<(), u32> {
    let current = Dacl::read(path)?;
    if already_granted(&current, sid, mask, true) {
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

/// Lets `sid` list `folder` itself, and nothing below it: the ACE is not inherited. Only this folder's own DACL
/// is written (SetFileSecurityW), so a parent such as the home folder is not walked the way an inheritable grant
/// walks its tree. Returns the Win32 error code on failure.
pub fn allow_list(folder: &str, sid: PSID) -> Result<(), u32> {
    let current = Dacl::read(folder)?;
    if already_granted(&current, sid, LIST, false) {
        return Ok(());
    }
    // SAFETY: zeroed EXPLICIT_ACCESS_W and SECURITY_DESCRIPTOR are valid empty values; every pointer passed lives
    // until the calls return, and `merged` is freed once the descriptor that points at it is no longer used.
    unsafe {
        let mut access: EXPLICIT_ACCESS_W = std::mem::zeroed();
        access.grfAccessPermissions = LIST;
        access.grfAccessMode = GRANT_ACCESS;
        access.grfInheritance = 0;
        access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        access.Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN;
        access.Trustee.ptstrName = sid as *mut u16;
        let mut merged: *mut ACL = null_mut();
        let code = SetEntriesInAclW(1, &access, current.acl, &mut merged);
        if code != ERROR_SUCCESS {
            return Err(code);
        }
        let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
        let descriptor_ptr = &mut descriptor as *mut SECURITY_DESCRIPTOR as *mut c_void;
        let mut written =
            InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION) != 0
                && SetSecurityDescriptorDacl(descriptor_ptr, 1, merged, 0) != 0;
        // Keep the folder's inheritance flags, or Windows would treat its inherited ACEs as explicit ones.
        let mut control: u16 = 0;
        let mut revision: u32 = 0;
        if written
            && GetSecurityDescriptorControl(current.descriptor, &mut control, &mut revision) != 0
        {
            let keep = control & (SE_DACL_AUTO_INHERITED | SE_DACL_PROTECTED);
            if keep != 0 {
                written = SetSecurityDescriptorControl(descriptor_ptr, keep, keep) != 0;
            }
        }
        let text = wide(folder);
        written = written
            && SetFileSecurityW(text.as_ptr(), DACL_SECURITY_INFORMATION, descriptor_ptr) != 0;
        let error = if written { 0 } else { GetLastError() };
        LocalFree(merged as *mut c_void);
        if !written {
            return Err(error);
        }
    }
    Ok(())
}

/// The capability every container carries, through which it lists the folders above a project. One ACE for it
/// serves every container, so a folder only an administrator can change, such as C:\Users, is granted once.
pub const LIST_CAPABILITY: &str = "draggySandboxList";

/// A capability SID from DeriveCapabilitySidsFromName, with the arrays that hold it; all freed on drop.
pub struct Capability {
    groups: *mut PSID,
    group_count: u32,
    sids: *mut PSID,
    sid_count: u32,
}

impl Capability {
    pub fn derive(name: &str) -> Result<Capability, u32> {
        let text = wide(name);
        let mut capability = Capability {
            groups: null_mut(),
            group_count: 0,
            sids: null_mut(),
            sid_count: 0,
        };
        // SAFETY: the name is NUL terminated; the out arrays are freed in Drop.
        let derived = unsafe {
            DeriveCapabilitySidsFromName(
                text.as_ptr(),
                &mut capability.groups,
                &mut capability.group_count,
                &mut capability.sids,
                &mut capability.sid_count,
            )
        };
        if derived == 0 {
            // SAFETY: reads the calling thread's last error.
            return Err(unsafe { GetLastError() });
        }
        if capability.sid_count == 0 {
            return Err(ERROR_INVALID_SID);
        }
        Ok(capability)
    }

    pub fn sid(&self) -> PSID {
        // SAFETY: `derive` checked that the array holds at least one SID.
        unsafe { *self.sids }
    }
}

impl Drop for Capability {
    fn drop(&mut self) {
        // SAFETY: each SID and both arrays were allocated by DeriveCapabilitySidsFromName with LocalAlloc.
        unsafe {
            for (array, count) in [(self.groups, self.group_count), (self.sids, self.sid_count)] {
                if array.is_null() {
                    continue;
                }
                for index in 0..count as usize {
                    LocalFree(*array.add(index));
                }
                LocalFree(array as *mut c_void);
            }
        }
    }
}

/// Lets `sid` list every folder above `folder`, up to the volume root. Returns the folders it could not change,
/// with the Win32 error code.
pub fn allow_ancestors(folder: &str, sid: PSID) -> Vec<(String, u32)> {
    std::path::Path::new(folder)
        .ancestors()
        .skip(1)
        .filter_map(|parent| {
            let parent = parent.to_string_lossy().into_owned();
            allow_list(&parent, sid).err().map(|code| (parent, code))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::FreeSid;
    use windows_sys::Win32::Security::Isolation::DeriveAppContainerSidFromAppContainerName;

    fn container_sid() -> PSID {
        let name = wide("dg.grant-test");
        let mut sid: PSID = null_mut();
        // SAFETY: the name is NUL terminated; the SID is freed by the caller.
        let code = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
        assert_eq!(code, 0);
        sid
    }

    #[test]
    fn a_list_grant_reaches_the_folder_but_not_what_is_inside() {
        let root = std::env::temp_dir().join(format!("dg-grant-{}", std::process::id()));
        std::fs::create_dir_all(root.join("project")).unwrap();
        let folder = root.to_string_lossy().into_owned();
        let sid = container_sid();

        assert_eq!(allow_list(&folder, sid), Ok(()));
        let dacl = Dacl::read(&folder).unwrap();
        assert!(already_granted(&dacl, sid, LIST, false));
        assert!(
            !already_granted(&dacl, sid, LIST, true),
            "the list ACE must not be inherited"
        );
        assert!(
            !already_granted(&dacl, sid, READ, false),
            "listing must not grant reading"
        );
        // A second call finds the ACE and changes nothing.
        assert_eq!(allow_list(&folder, sid), Ok(()));
        let child = Dacl::read(&root.join("project").to_string_lossy()).unwrap();
        assert!(
            !already_granted(&child, sid, LIST, false),
            "the child must not gain the ACE"
        );
        // SAFETY: the SID came from DeriveAppContainerSidFromAppContainerName.
        unsafe { FreeSid(sid) };
        let _ = std::fs::remove_dir_all(&root);
    }
}
