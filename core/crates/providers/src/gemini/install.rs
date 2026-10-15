//! The pinned Gemini CLI, installed by the user's own npm from a lockfile shipped in the app, so every package is
//! checked against an integrity Draggy chose rather than whatever the registry serves.

use std::path::Path;

use crate::account::supervisor::RuntimeUnavailable;
use crate::install_fs::{InstallFs, SingleFlight};
use crate::js::fixed_one;

pub const VERSION: &str = "0.61.0";
// Measured for 0.61.0 without its optional packages; the bar follows the folder's size toward it.
pub const EXPECTED_BYTES: u64 = 98_294_669;
const ENTRY: [&str; 5] = [
    "node_modules",
    "@google",
    "gemini-cli",
    "bundle",
    "gemini.js",
];
/// The lockfile's files, copied into the staging folder before npm reads them.
pub const LOCK_FILES: [&str; 2] = ["package.json", "package-lock.json"];
/// npm's arguments: a clean install from the lockfile, with no scripts and no optional packages.
pub const NPM_ARGS: [&str; 7] = [
    "ci",
    "--omit=optional",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--loglevel",
    "error",
];

/// The folder one pin installs into.
pub fn install_dir(app_data: &str) -> String {
    Path::new(app_data)
        .join("gemini")
        .join("cli")
        .join(VERSION)
        .to_string_lossy()
        .into_owned()
}

/// The entry point inside an install, or None when there is none.
pub fn installed_entry(app_data: &str, fs: &dyn crate::install_fs::FileView) -> Option<String> {
    let file = ENTRY.iter().fold(
        Path::new(&install_dir(app_data)).to_path_buf(),
        |path, part| path.join(part),
    );
    let file = file.to_string_lossy().into_owned();
    fs.exists(&file).then_some(file)
}

/// The percent the install bar shows while npm works: the folder's bytes against the expected total, capped at 99.
pub fn progress_percent(folder_bytes: u64) -> f64 {
    fixed_one((folder_bytes as f64 / EXPECTED_BYTES as f64) * 100.0).min(99.0)
}

/// What npm said when it finished: its exit code, and the end of its stderr.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpmResult {
    pub code: Option<i32>,
    pub stderr: String,
}

/// Runs `npm ci` in a folder. The shell backs this with the user's own npm, run through Node; npm writes to the disk,
/// which the file system seam stands in for in a test.
pub trait Npm {
    fn run_ci(&mut self, cwd: &str, args: &[&str], fs: &mut dyn InstallFs) -> NpmResult;
}

/// The last three lines of npm's stderr, joined, as the error names them.
fn detail_of(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.trim().split('\n').collect();
    let start = lines.len().saturating_sub(3);
    lines[start..].join(" ")
}

/// Resolves to the CLI's entry point, installing it first if needed. Callers at once share one install, so two of them
/// never empty each other's staging folder.
pub fn ensure(
    flight: &SingleFlight<Result<Option<String>, RuntimeUnavailable>>,
    app_data: &str,
    npm_available: bool,
    lock: &[(&str, &str)],
    npm: &mut dyn Npm,
    fs: &mut dyn InstallFs,
) -> Result<Option<String>, RuntimeUnavailable> {
    if let Some(existing) = installed_entry(app_data, fs) {
        return Ok(Some(existing));
    }
    flight.run(app_data, || install(app_data, npm_available, lock, npm, fs))
}

/// Installs the pinned CLI into a staging folder with the lockfile, then moves it into place. A failed install keeps
/// nothing, and says why in its error.
pub fn install(
    app_data: &str,
    npm_available: bool,
    lock: &[(&str, &str)],
    npm: &mut dyn Npm,
    fs: &mut dyn InstallFs,
) -> Result<Option<String>, RuntimeUnavailable> {
    if let Some(existing) = installed_entry(app_data, fs) {
        return Ok(Some(existing));
    }
    if !npm_available {
        return Err(RuntimeUnavailable(
            "The Google account needs npm, which comes with Node.js, to install the Gemini CLI."
                .to_owned(),
        ));
    }
    let dir = install_dir(app_data);
    let staging = format!("{dir}.part");
    fs.remove_tree(&staging);
    fs.make_dir(&staging);
    for (name, text) in lock {
        let file = Path::new(&staging)
            .join(name)
            .to_string_lossy()
            .into_owned();
        fs.write_file(&file, text.as_bytes());
    }
    let result = npm.run_ci(&staging, &NPM_ARGS, fs);
    let entry_ready = installed_entry_in(&staging, fs);
    if result.code != Some(0) || !entry_ready {
        fs.remove_tree(&staging);
        let detail = detail_of(&result.stderr);
        let suffix = if detail.is_empty() {
            ".".to_owned()
        } else {
            format!(": {detail}")
        };
        return Err(RuntimeUnavailable(format!(
            "The Gemini CLI could not be installed{suffix}"
        )));
    }
    fs.remove_tree(&dir);
    fs.rename(&staging, &dir).map_err(RuntimeUnavailable)?;
    Ok(installed_entry(app_data, fs))
}

fn installed_entry_in(root: &str, fs: &dyn crate::install_fs::FileView) -> bool {
    let file = ENTRY
        .iter()
        .fold(Path::new(root).to_path_buf(), |path, part| path.join(part));
    fs.exists(&file.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::install_fs::memory::{MemFs, joined};

    const APP: &str = "/data/Draggy";

    /// npm as a fake: it records its arguments and, when asked, writes the entry point into the folder it ran in.
    struct FakeNpm {
        code: Option<i32>,
        stderr: String,
        writes_entry: bool,
        seen: RefCell<Vec<(String, Vec<String>)>>,
    }

    impl FakeNpm {
        fn ok() -> Self {
            Self {
                code: Some(0),
                stderr: String::new(),
                writes_entry: true,
                seen: RefCell::new(Vec::new()),
            }
        }
    }

    impl Npm for FakeNpm {
        fn run_ci(&mut self, cwd: &str, args: &[&str], fs: &mut dyn InstallFs) -> NpmResult {
            self.seen.borrow_mut().push((
                cwd.to_owned(),
                args.iter().map(|a| (*a).to_owned()).collect(),
            ));
            if self.writes_entry {
                let entry = ENTRY
                    .iter()
                    .fold(Path::new(cwd).to_path_buf(), |p, part| p.join(part));
                fs.write_file(&entry.to_string_lossy(), b"console.log(1)");
            }
            NpmResult {
                code: self.code,
                stderr: self.stderr.clone(),
            }
        }
    }

    /// npm that announces it has started, then waits for the test to let it finish.
    struct GatedNpm {
        started: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }

    impl Npm for GatedNpm {
        fn run_ci(&mut self, cwd: &str, _args: &[&str], fs: &mut dyn InstallFs) -> NpmResult {
            let _ = self.started.send(());
            let _ = self.release.recv();
            let entry = ENTRY
                .iter()
                .fold(Path::new(cwd).to_path_buf(), |p, part| p.join(part));
            fs.write_file(&entry.to_string_lossy(), b"console.log(1)");
            NpmResult {
                code: Some(0),
                stderr: String::new(),
            }
        }
    }

    fn lock() -> Vec<(&'static str, &'static str)> {
        vec![("package.json", "{}"), ("package-lock.json", "{}")]
    }

    #[test]
    fn installs_the_locked_tree_with_npm_ci_and_its_flags() {
        let mut fs = MemFs::default();
        let mut npm = FakeNpm::ok();
        let entry = install(APP, true, &lock(), &mut npm, &mut fs);
        assert_eq!(
            entry.map(|e| e.map(|p| Path::new(&p).ends_with("bundle/gemini.js"))),
            Ok(Some(true))
        );
        let seen = npm.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].0.ends_with(".part"));
        assert_eq!(
            seen[0].1,
            NPM_ARGS.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>()
        );
        assert!(fs.has_file(&format!("{}/package-lock.json", install_dir(APP))));
        assert!(!fs.has_tree(&format!("{}.part", install_dir(APP))));
    }

    #[test]
    fn npm_runs_ci_with_the_reference_flags() {
        assert_eq!(
            NPM_ARGS,
            [
                "ci",
                "--omit=optional",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--loglevel",
                "error",
            ]
        );
    }

    #[test]
    fn says_npm_is_needed_when_it_is_missing() {
        let mut fs = MemFs::default();
        let result = install(APP, false, &lock(), &mut FakeNpm::ok(), &mut fs);
        assert_eq!(
            result,
            Err(RuntimeUnavailable("The Google account needs npm, which comes with Node.js, to install the Gemini CLI.".to_owned()))
        );
    }

    #[test]
    fn keeps_nothing_from_a_failed_install_and_names_its_last_lines() {
        let mut fs = MemFs::default();
        let mut npm = FakeNpm {
            code: Some(1),
            stderr: "one\ntwo\nthree\nfour\nfive".to_owned(),
            writes_entry: false,
            seen: RefCell::new(Vec::new()),
        };
        let result = install(APP, true, &lock(), &mut npm, &mut fs);
        assert_eq!(
            result,
            Err(RuntimeUnavailable(
                "The Gemini CLI could not be installed: three four five".to_owned()
            ))
        );
        assert!(!fs.has_tree(&format!("{}.part", install_dir(APP))));
        let mut silent = FakeNpm {
            code: Some(2),
            stderr: String::new(),
            writes_entry: false,
            seen: RefCell::new(Vec::new()),
        };
        let quiet = install(APP, true, &lock(), &mut silent, &mut fs);
        assert_eq!(
            quiet,
            Err(RuntimeUnavailable(
                "The Gemini CLI could not be installed.".to_owned()
            ))
        );
    }

    #[test]
    fn an_installed_cli_is_not_installed_again() {
        let mut fs = MemFs::default();
        fs.write_file(
            &format!(
                "{}/node_modules/@google/gemini-cli/bundle/gemini.js",
                install_dir(APP)
            ),
            b"x",
        );
        let mut npm = FakeNpm::ok();
        let entry = install(APP, true, &lock(), &mut npm, &mut fs);
        assert!(entry.is_ok_and(|e| e.is_some()));
        assert!(npm.seen.borrow().is_empty());
    }

    #[test]
    fn callers_at_once_share_one_install() {
        let flight: std::sync::Arc<SingleFlight<Result<Option<String>, RuntimeUnavailable>>> =
            std::sync::Arc::new(SingleFlight::default());
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let leader = {
            let flight = std::sync::Arc::clone(&flight);
            std::thread::spawn(move || {
                let mut fs = MemFs::default();
                let mut npm = GatedNpm {
                    started: started_tx,
                    release: release_rx,
                };
                ensure(&flight, APP, true, &lock(), &mut npm, &mut fs)
            })
        };
        started_rx.recv().expect("the leader started npm");
        let follower = {
            let flight = std::sync::Arc::clone(&flight);
            std::thread::spawn(move || {
                let mut fs = MemFs::default();
                ensure(&flight, APP, true, &lock(), &mut FakeNpm::ok(), &mut fs)
            })
        };
        while flight.waiters(APP) == 0 {
            std::thread::yield_now();
        }
        release_tx.send(()).expect("npm is waiting");
        let expected = Ok(Some(joined(&install_dir(APP), &ENTRY)));
        assert_eq!(leader.join().expect("leader joins"), expected);
        assert_eq!(follower.join().expect("follower joins"), expected);
    }

    #[test]
    fn the_bar_follows_the_folder_toward_the_expected_size_and_stops_at_99() {
        assert_eq!(progress_percent(EXPECTED_BYTES / 2), 50.0);
        assert_eq!(progress_percent(EXPECTED_BYTES * 2), 99.0);
    }
}
