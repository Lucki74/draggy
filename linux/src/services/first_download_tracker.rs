use std::path::PathBuf;

pub struct FirstDownloadTracker;

impl FirstDownloadTracker {
    fn marker_path() -> PathBuf {
        gtk::glib::user_data_dir().join("draggy").join(".onboarded")
    }

    pub fn is_first_run() -> bool {
        !Self::marker_path().exists()
    }

    pub fn mark_completed() {
        let p = Self::marker_path();
        if let Some(parent) = p.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                tracing::warn!(target: "linux.app", kind = ?error.kind(), "first run folder could not be created");
            }
        }
        if let Err(error) = std::fs::write(&p, "1") {
            tracing::warn!(target: "linux.app", kind = ?error.kind(), "first run marker could not be written");
        } else {
            tracing::debug!(target: "linux.app", "first run marker written");
        }
    }
}
