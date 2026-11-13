//! Chromium's `v10` scheme on Windows: AES-256-GCM, a 12-byte nonce, then ciphertext and the 16-byte tag.
//! Blobs match what Electron's safeStorage writes, so either shell reads the other's store.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use draggy_storage::secrets::{SecretVault, VaultError};
use zeroize::Zeroizing;

const PREFIX: &[u8] = b"v10";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

/// Holds the AES key that Local State unwraps. Dropping it wipes the key.
pub struct WindowsVault {
    key: Zeroizing<[u8; 32]>,
}

impl WindowsVault {
    pub fn new(key: Zeroizing<[u8; 32]>) -> Self {
        Self { key }
    }

    fn cipher(&self) -> Result<Aes256Gcm, VaultError> {
        Aes256Gcm::new_from_slice(self.key.as_slice())
            .map_err(|_| VaultError("the key has the wrong length".into()))
    }
}

impl SecretVault for WindowsVault {
    fn available(&self) -> bool {
        true
    }

    /// Windows has no backend call, so `None` keeps the Linux-only `basic_text` check out of the way.
    fn backend(&self) -> Option<String> {
        None
    }

    fn encrypt(&self, plain: &[u8]) -> Result<Vec<u8>, VaultError> {
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut nonce)
            .map_err(|_| VaultError("no randomness for the nonce".into()))?;
        let sealed = self
            .cipher()?
            .encrypt(Nonce::from_slice(&nonce), plain)
            .map_err(|_| VaultError("the encryption failed".into()))?;

        let mut out = Vec::with_capacity(PREFIX.len() + NONCE_LEN + sealed.len());
        out.extend_from_slice(PREFIX);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(out)
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, VaultError> {
        let body = blob
            .strip_prefix(PREFIX)
            .ok_or_else(|| VaultError("the blob has no v10 prefix".into()))?;
        if body.len() < NONCE_LEN + TAG_LEN {
            return Err(VaultError("the blob is too short".into()));
        }
        let (nonce, sealed) = body.split_at(NONCE_LEN);
        self.cipher()?
            .decrypt(Nonce::from_slice(nonce), sealed)
            .map_err(|_| VaultError("the blob failed authentication".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known_key() -> Zeroizing<[u8; 32]> {
        let mut key = [0u8; 32];
        for (i, byte) in key.iter_mut().enumerate() {
            *byte = i as u8;
        }
        Zeroizing::new(key)
    }

    /// Made with Node's aes-256-gcm: key 00..1f, nonce 01..0c, plaintext of a GitHub token record.
    const ELECTRON_V10: &str = "7631300102030405060708090a0b0c7ec83dbc98fc85e46e981865575abe601701beaad826158b8365db43f6c629b1e197effd13c881570622b564422aa835a49c03ddee51";

    fn from_hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
            .collect()
    }

    #[test]
    fn decrypts_a_blob_made_by_electron_with_a_known_key() {
        let vault = WindowsVault::new(known_key());

        let plain = vault.decrypt(&from_hex(ELECTRON_V10)).expect("decrypt");

        assert_eq!(plain, br#"{"github":{"GITHUB_TOKEN":"ghp_test"}}"#);
    }

    #[test]
    fn encrypt_output_decrypts_and_starts_with_v10() {
        let vault = WindowsVault::new(known_key());

        let blob = vault.encrypt(b"secret").expect("encrypt");

        assert!(blob.starts_with(b"v10"));
        assert_eq!(vault.decrypt(&blob).expect("decrypt"), b"secret");
    }

    #[test]
    fn rejects_a_tampered_tag_and_a_missing_prefix() {
        let vault = WindowsVault::new(known_key());
        let mut blob = from_hex(ELECTRON_V10);
        let last = blob.len() - 1;
        blob[last] ^= 1;

        assert!(vault.decrypt(&blob).is_err());
        assert!(vault.decrypt(b"v11 nope nope nope nope").is_err());
    }
}
