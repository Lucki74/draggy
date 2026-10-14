//! The file system and the download an installer of a pinned runtime needs, as traits. The shell backs them with the
//! disk and the network; tests back them with memory, so the install's own rules run without either.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use ring::digest::{SHA256, digest};

use crate::http::{ByteStream, TransportError};
use crate::js::fixed_one;

/// Read-only view: what exists, and what a folder holds.
pub trait FileView {
    fn exists(&self, path: &str) -> bool;
    /// The names in a folder, or None when the folder is not there.
    fn list(&self, dir: &str) -> Option<Vec<String>>;
}

/// The writes an install makes, in the order it makes them.
pub trait InstallFs: FileView {
    fn write_file(&mut self, path: &str, bytes: &[u8]);
    /// Adds bytes to the end of a file, which a download does one chunk at a time.
    fn append_file(&mut self, path: &str, bytes: &[u8]);
    fn make_dir(&mut self, path: &str);
    /// Removes a folder and everything in it. Removing what is not there is not an error.
    fn remove_tree(&mut self, path: &str);
    fn rename(&mut self, from: &str, to: &str) -> Result<(), String>;
    /// The SHA-256 of a file in lowercase hex, or None when there is no such file.
    fn sha256(&self, path: &str) -> Option<String>;
    fn set_executable(&mut self, path: &str);
}

/// Opens an asset's body for reading a chunk at a time, so a large build never sits whole in memory. A failure says
/// why; the install leaves nothing behind.
pub trait Download {
    fn open(&mut self, url: &str) -> Result<Box<dyn ByteStream>, TransportError>;
}

/// Writes a download into a file a chunk at a time, reporting progress after each chunk. Returns the bytes written.
pub fn stream_to_file(
    body: &mut dyn ByteStream,
    file: &str,
    total: u64,
    fs: &mut dyn InstallFs,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<u64, TransportError> {
    fs.write_file(file, &[]);
    let mut completed = 0u64;
    while let Some(chunk) = body.next_chunk()? {
        completed += chunk.len() as u64;
        fs.append_file(file, &chunk);
        on_progress(Progress {
            completed,
            total,
            percent: percent_of(completed, total),
        });
    }
    Ok(completed)
}

/// Lowercase hex SHA-256 of some bytes.
pub fn sha256_hex(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// A download's progress as the renderer shows it: bytes so far, the total, and the percent to one decimal place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Progress {
    pub completed: u64,
    pub total: u64,
    pub percent: f64,
}

/// The percent to one decimal place, as `Number(x.toFixed(1))` gives it.
pub fn percent_of(completed: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    fixed_one((completed as f64 / total as f64) * 100.0)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Callers at once share one run per key: the first does the work and the rest wait for its answer, as the reference's
/// `installing` map does. A listing and a sign-in would otherwise empty each other's staging folder.
pub struct SingleFlight<T> {
    runs: Mutex<HashMap<String, Arc<Run<T>>>>,
}

struct Run<T> {
    state: Mutex<RunState<T>>,
    ready: Condvar,
}

struct RunState<T> {
    answer: Option<T>,
    waiting: usize,
    /// The leader's work ended without an answer (it panicked), so a waiter takes the run over.
    abandoned: bool,
}

/// Forgets a run when its leader leaves, answered or not, so no later caller waits on it forever.
struct Leave<'a, T> {
    flight: &'a SingleFlight<T>,
    key: &'a str,
    run: Arc<Run<T>>,
}

impl<T> Drop for Leave<'_, T> {
    fn drop(&mut self) {
        {
            let mut state = lock(&self.run.state);
            state.abandoned = state.answer.is_none();
        }
        let mut runs = lock(&self.flight.runs);
        if runs
            .get(self.key)
            .is_some_and(|run| Arc::ptr_eq(run, &self.run))
        {
            runs.remove(self.key);
        }
        drop(runs);
        self.run.ready.notify_all();
    }
}

impl<T: Clone + Send> Default for SingleFlight<T> {
    fn default() -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
        }
    }
}

impl<T: Clone + Send> SingleFlight<T> {
    /// Runs `work` unless another caller is already running it for this key, and then returns that caller's answer.
    /// When that caller's work panics, this caller runs its own work instead of waiting for an answer that never comes.
    pub fn run(&self, key: &str, work: impl FnOnce() -> T) -> T {
        let (run, leader) = self.join(key);
        if leader {
            let leave = Leave {
                flight: self,
                key,
                run,
            };
            let answer = work();
            lock(&leave.run.state).answer = Some(answer.clone());
            return answer;
        }
        if let Some(answer) = Self::await_answer(&run) {
            return answer;
        }
        self.run(key, work)
    }

    /// The run for this key, and whether this caller leads it: a new run is made when none is in progress.
    fn join(&self, key: &str) -> (Arc<Run<T>>, bool) {
        let mut runs = lock(&self.runs);
        match runs.get(key) {
            Some(run) => (Arc::clone(run), false),
            None => {
                let run = Arc::new(Run {
                    state: Mutex::new(RunState {
                        answer: None,
                        waiting: 0,
                        abandoned: false,
                    }),
                    ready: Condvar::new(),
                });
                runs.insert(key.to_owned(), Arc::clone(&run));
                (run, true)
            }
        }
    }

    /// Waits for the leader's answer; None when the leader left without one.
    fn await_answer(run: &Run<T>) -> Option<T> {
        let mut state = lock(&run.state);
        state.waiting += 1;
        loop {
            if let Some(shared) = state.answer.as_ref() {
                return Some(shared.clone());
            }
            if state.abandoned {
                return None;
            }
            state = run
                .ready
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// How many callers are waiting on a run in progress for this key.
    #[cfg(test)]
    pub(crate) fn waiters(&self, key: &str) -> usize {
        let run = lock(&self.runs).get(key).cloned();
        run.map_or(0, |run| lock(&run.state).waiting)
    }
}

/// An in-memory file system for the installers' tests: files, folders, links and the executable bits.
#[cfg(test)]
pub(crate) mod memory {
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::Path;

    use std::collections::VecDeque;

    use super::{Download, FileView, InstallFs, sha256_hex};
    use crate::http::{ByteStream, TransportError};

    /// A download that serves fixed chunks, or refuses with a message, and counts how often it was opened.
    #[derive(Default)]
    pub(crate) struct ChunkedDownload {
        pub chunks: Vec<Vec<u8>>,
        pub refuse: Option<String>,
        pub opened: u32,
    }

    struct Served(VecDeque<Vec<u8>>);

    impl ByteStream for Served {
        fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
            Ok(self.0.pop_front())
        }

        fn cancel(&mut self) {
            self.0.clear();
        }
    }

    impl Download for ChunkedDownload {
        fn open(&mut self, _url: &str) -> Result<Box<dyn ByteStream>, TransportError> {
            self.opened += 1;
            if let Some(message) = &self.refuse {
                return Err(TransportError {
                    message: message.clone(),
                    cause_message: None,
                    code: None,
                });
            }
            Ok(Box::new(Served(self.chunks.clone().into())))
        }
    }

    #[derive(Default, Debug)]
    pub(crate) struct MemFs {
        pub files: BTreeMap<String, Vec<u8>>,
        pub dirs: BTreeSet<String>,
        pub links: BTreeMap<String, String>,
        pub executable: BTreeSet<String>,
    }

    /// A path built the way the installers build theirs, so a test's expectation matches on any platform.
    pub(crate) fn joined(first: &str, rest: &[&str]) -> String {
        rest.iter()
            .fold(Path::new(first).to_path_buf(), |p, part| p.join(part))
            .to_string_lossy()
            .into_owned()
    }

    fn parent_of(path: &str) -> Option<String> {
        Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
    }

    /// The tests key folders with forward slashes; Windows joins add backslashes, so both name one entry.
    fn key(path: &str) -> String {
        path.replace(std::path::MAIN_SEPARATOR, "/")
    }

    fn under(path: &str, root: &str) -> bool {
        path == root || path.starts_with(&format!("{root}/"))
    }

    impl MemFs {
        pub fn has_file(&self, path: &str) -> bool {
            self.files.contains_key(&key(path))
        }

        pub fn is_executable(&self, path: &str) -> bool {
            self.executable.contains(&key(path))
        }

        pub fn has_tree(&self, root: &str) -> bool {
            self.dirs.iter().any(|d| under(d, root)) || self.files.keys().any(|f| under(f, root))
        }
    }

    impl FileView for MemFs {
        fn exists(&self, path: &str) -> bool {
            let path = key(path);
            self.files.contains_key(&path)
                || self.dirs.contains(&path)
                || self.links.contains_key(&path)
        }

        fn list(&self, dir: &str) -> Option<Vec<String>> {
            let dir = key(dir);
            let dir = dir.as_str();
            let names = self
                .dirs
                .iter()
                .chain(self.files.keys())
                .chain(self.links.keys())
                .filter(|p| parent_of(p).as_deref() == Some(dir))
                .filter_map(|p| {
                    Path::new(p)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                })
                .collect::<BTreeSet<String>>();
            // A folder that holds something exists, as it does on disk, even when it was never made by name.
            if names.is_empty() && !self.dirs.contains(dir) {
                return None;
            }
            Some(names.into_iter().collect())
        }
    }

    impl InstallFs for MemFs {
        fn write_file(&mut self, path: &str, bytes: &[u8]) {
            self.files.insert(key(path), bytes.to_vec());
        }

        fn append_file(&mut self, path: &str, bytes: &[u8]) {
            self.files
                .entry(key(path))
                .or_default()
                .extend_from_slice(bytes);
        }

        fn make_dir(&mut self, path: &str) {
            self.dirs.insert(key(path));
        }

        fn remove_tree(&mut self, path: &str) {
            let path = key(path);
            let path = path.as_str();
            self.dirs.retain(|d| !under(d, path));
            self.files.retain(|f, _| !under(f, path));
            self.links.retain(|l, _| !under(l, path));
            self.executable.retain(|f| !under(f, path));
        }

        fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
            let (from, to) = (key(from), key(to));
            let (from, to) = (from.as_str(), to.as_str());
            if !self.dirs.contains(from) {
                return Err(format!("no folder {from}"));
            }
            let moved = |p: &str| format!("{to}{}", &p[from.len()..]);
            let dirs: Vec<String> = self
                .dirs
                .iter()
                .filter(|d| under(d, from))
                .cloned()
                .collect();
            for dir in dirs {
                self.dirs.remove(&dir);
                self.dirs.insert(moved(&dir));
            }
            let files: Vec<String> = self
                .files
                .keys()
                .filter(|f| under(f, from))
                .cloned()
                .collect();
            for file in files {
                if let Some(bytes) = self.files.remove(&file) {
                    self.files.insert(moved(&file), bytes);
                }
            }
            let modes: Vec<String> = self
                .executable
                .iter()
                .filter(|f| under(f, from))
                .cloned()
                .collect();
            for mode in modes {
                self.executable.remove(&mode);
                self.executable.insert(moved(&mode));
            }
            Ok(())
        }

        fn sha256(&self, path: &str) -> Option<String> {
            self.files.get(&key(path)).map(|bytes| sha256_hex(bytes))
        }

        fn set_executable(&mut self, path: &str) {
            self.executable.insert(key(path));
        }
    }
}

#[cfg(test)]
mod flight_tests {
    use std::panic::AssertUnwindSafe;
    use std::sync::mpsc;
    use std::thread;

    use super::SingleFlight;

    #[test]
    fn a_later_caller_is_not_stranded_by_a_panicking_leader() {
        let flight = SingleFlight::<u32>::default();
        let panicked = std::panic::catch_unwind(AssertUnwindSafe(|| {
            flight.run("k", || panic!("work failed"))
        }));
        assert!(panicked.is_err());
        assert_eq!(flight.run("k", || 7), 7);
    }

    #[test]
    fn a_waiter_takes_the_run_over_when_the_leader_panics() {
        let owned = SingleFlight::<u32>::default();
        let flight = &owned;
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        thread::scope(|scope| {
            let leader = scope.spawn(move || {
                flight.run("k", move || {
                    started_tx.send(()).ok();
                    release_rx.recv().ok();
                    panic!("work failed")
                })
            });
            started_rx.recv().ok();
            let waiter = scope.spawn(move || flight.run("k", || 9));
            while flight.waiters("k") == 0 {
                thread::yield_now();
            }
            release_tx.send(()).ok();
            assert!(
                leader.join().is_err(),
                "the leader's panic reaches its caller"
            );
            assert_eq!(waiter.join().ok(), Some(9));
        });
    }
}
