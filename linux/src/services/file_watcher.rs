use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

pub struct SimpleFileWatcher {
    path: PathBuf,
    is_running: Arc<AtomicBool>,
}

impl SimpleFileWatcher {
    pub fn new<P: AsRef<Path>>(path: P) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start<F>(&self, on_change: F)
    where
        F: Fn() + Send + 'static,
    {
        self.is_running.store(true, Ordering::SeqCst);
        let running = Arc::clone(&self.is_running);
        let watch_path = self.path.clone();

        thread::spawn(move || {
            let mut last_modified = std::fs::metadata(&watch_path)
                .and_then(|m| m.modified())
                .ok();

            while running.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(800));
                if let Ok(meta) = std::fs::metadata(&watch_path) {
                    if let Ok(current_mod) = meta.modified() {
                        if Some(current_mod) != last_modified {
                            last_modified = Some(current_mod);
                            on_change();
                        }
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

impl Drop for SimpleFileWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}
