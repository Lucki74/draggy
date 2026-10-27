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
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(p, "1");
    }
}
