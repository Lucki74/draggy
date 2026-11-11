//! Where Draggy keeps its data. Electron names the folder after the app, so Tauri's identifier-derived
//! folder would look like a lost install.

use std::ffi::OsString;
use std::path::PathBuf;

/// The folder name Electron's `app.setName("Draggy")` gives under `%APPDATA%`.
const APP_FOLDER: &str = "Draggy";

/// `%APPDATA%\Draggy`. A missing `APPDATA` is an error: guessing another folder would start a fresh,
/// empty profile beside the real one.
pub fn data_dir(appdata: Option<OsString>) -> Result<PathBuf, String> {
    let base = appdata
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "APPDATA is not set".to_owned())?;
    Ok(PathBuf::from(base).join(APP_FOLDER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_the_app_folder_under_appdata() {
        let dir = data_dir(Some(OsString::from(r"C:\Users\x\AppData\Roaming"))).unwrap();
        assert_eq!(
            dir,
            PathBuf::from(r"C:\Users\x\AppData\Roaming").join("Draggy")
        );
    }

    #[test]
    fn refuses_to_guess_without_appdata() {
        assert!(data_dir(None).is_err());
        assert!(data_dir(Some(OsString::new())).is_err());
    }
}
