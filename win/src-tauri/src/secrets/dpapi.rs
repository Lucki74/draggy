//! DPAPI wrappers for the current user. The only unsafe code in the secrets module.

use std::ffi::c_void;

use windows::Win32::Foundation::{E_INVALIDARG, HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use zeroize::{Zeroize, Zeroizing};

/// Wraps `plain` so only the current Windows user can unwrap it.
pub fn protect(plain: &[u8]) -> windows::core::Result<Vec<u8>> {
    call(plain, true).map(|out| out.to_vec())
}

/// Unwraps a DPAPI blob. The output is secret material, so it is wiped on drop.
pub fn unprotect(blob: &[u8]) -> windows::core::Result<Zeroizing<Vec<u8>>> {
    call(blob, false)
}

fn call(input: &[u8], protecting: bool) -> windows::core::Result<Zeroizing<Vec<u8>>> {
    let len = u32::try_from(input.len()).map_err(|_| windows::core::Error::from(E_INVALIDARG))?;
    let blob = CRYPT_INTEGER_BLOB {
        cbData: len,
        // The API takes a mutable pointer but does not write through the input blob.
        pbData: input.as_ptr().cast_mut(),
    };
    let mut out = CRYPT_INTEGER_BLOB::default();

    // SAFETY: `blob` borrows `input` for the duration of the call. The API allocates `out.pbData`
    // with LocalAlloc, which is copied out and freed with LocalFree on every success path.
    unsafe {
        if protecting {
            CryptProtectData(
                &blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )?;
        } else {
            CryptUnprotectData(
                &blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )?;
        }
        let native = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
        let copied = Zeroizing::new(native.to_vec());
        native.zeroize();
        LocalFree(Some(HLOCAL(out.pbData.cast::<c_void>())));
        Ok(copied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_bytes_for_the_current_user() {
        let plain = b"0123456789abcdef0123456789abcdef";
        let blob = protect(plain).expect("protect");

        assert_ne!(blob.as_slice(), plain.as_slice());
        assert_eq!(
            unprotect(&blob).expect("unprotect").as_slice(),
            plain.as_slice()
        );
    }

    #[test]
    fn refuses_a_blob_it_did_not_write() {
        assert!(unprotect(b"not a dpapi blob").is_err());
    }
}
