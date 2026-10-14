//! Read-only git for the model: status and diffs, never a commit, stage or fetch. Ports electron/git.cjs. Repository
//! config can run programs (fsmonitor, filters, diff drivers), so every call switches those off and takes no locks.

use std::ffi::OsString;
use std::future::Future;
use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::OnceCell;

use crate::fs_guard::relative_text;
use crate::js;
use crate::spawn::{self, CancelToken, CaptureLimits, SpawnError, SpawnOptions};

/// How long one git call may take before it is treated as hung.
pub const GIT_TIMEOUT: Duration = Duration::from_secs(10);
/// How much output one call may hold, in characters; past it the call counts as failed, as Node's maxBuffer does.
pub const MAX_OUTPUT_CHARS: usize = 16 * 1024 * 1024;
/// How much diff a caller gets, in UTF-16 units as the reference counts it. Beyond this it is truncated and says so.
pub const MAX_DIFF_CHARS: usize = 60_000;
/// How many files one diff names. Past this the command line gets long.
pub const MAX_DIFF_FILES: usize = 300;
/// How many changed files a status lists.
pub const MAX_STATUS_FILES: usize = 500;

/// Flags that go before every subcommand. Paths are paths, and output is plain.
pub const SAFE_FLAGS: [&str; 8] = [
    "--no-pager",
    "--literal-pathspecs",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.quotepath=false",
    "-c",
    "color.ui=false",
];

/// What one git call returned. `missing` means there is no git to run at all.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitRun {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub missing: bool,
}

/// Runs git. The real one starts a hidden process through `spawn`; tests answer from a script.
pub trait GitRunner {
    fn run(&self, args: &[String], cwd: &Path) -> impl Future<Output = GitRun> + Send;
}

/// Runs the git on the PATH, hidden, with a timeout and output cut-off, and with the prompts and locks switched off.
#[derive(Debug, Clone, Copy, Default)]
pub struct SpawnRunner;

impl GitRunner for SpawnRunner {
    async fn run(&self, args: &[String], cwd: &Path) -> GitRun {
        let mut env: Vec<(OsString, OsString)> = std::env::vars_os()
            .filter(|(key, _)| {
                !matches!(
                    key.to_str(),
                    Some("GIT_TERMINAL_PROMPT" | "GIT_OPTIONAL_LOCKS")
                )
            })
            .collect();
        env.push(("GIT_TERMINAL_PROMPT".into(), "0".into()));
        env.push(("GIT_OPTIONAL_LOCKS".into(), "0".into()));

        let options = SpawnOptions {
            cwd: Some(cwd.to_path_buf()),
            env: Some(env),
            timeout: GIT_TIMEOUT,
            cancel: CancelToken::new(),
            merge_output: false,
            capture: CaptureLimits {
                limit: MAX_OUTPUT_CHARS,
                head: MAX_OUTPUT_CHARS,
                tail: 0,
            },
        };
        match spawn::run("git", args, options).await {
            Ok(output) => {
                // A run that was stopped, or never exited, counts as a failure with code 1, as Node reports it.
                let stopped = output.timed_out || output.cancelled;
                let code = match output.exit_code {
                    Some(code) if !stopped && !output.stdout.is_cut() => code,
                    _ => 1,
                };
                GitRun {
                    code,
                    stdout: output.stdout.head,
                    stderr: output.stderr.head,
                    missing: false,
                }
            }
            Err(SpawnError::Start { source, .. }) if source.kind() == ErrorKind::NotFound => {
                GitRun {
                    code: -1,
                    missing: true,
                    ..GitRun::default()
                }
            }
            // A run that never started has no stderr, as the reference's execFile callback gives none.
            Err(_) => GitRun {
                code: 1,
                ..GitRun::default()
            },
        }
    }
}

/// The kind of change a status entry describes, in plain words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

/// One changed file. `from` is set only for a rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub kind: Kind,
    pub staged: bool,
    pub unstaged: bool,
}

/// The branch and the changed files of a repository, as `git status --porcelain=v2 --branch` describes them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Status {
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub files: Vec<FileChange>,
    pub truncated: bool,
}

/// How many files of each kind changed, for a status strip.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub modified: usize,
    pub added: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub untracked: usize,
    pub conflicted: usize,
}

/// What a status call found. Folders outside git and machines without git are answers, not failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepoState {
    NoGit,
    NotRepo,
    Repo { status: Status, counts: Counts },
}

/// Why a git call could not answer. The messages are the ones the model reads.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitError {
    #[error("Git is not installed.")]
    NotInstalled,
    #[error("This folder is not a git repository.")]
    NotRepository,
    #[error("This repository's configuration could run programs, so Draggy will not read it.")]
    Refused,
    #[error("{0}")]
    Failed(String),
}

/// A working-tree or staged diff, as the model asked for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diff {
    pub diff: String,
    pub truncated: bool,
    pub staged: bool,
    pub files: usize,
    pub skipped: usize,
}

/// The git calls for one process. Remembers whether git exists, since that does not change while Draggy runs.
pub struct Git<R = SpawnRunner> {
    runner: R,
    available: OnceCell<bool>,
}

impl Default for Git<SpawnRunner> {
    fn default() -> Self {
        Self::with_runner(SpawnRunner)
    }
}

impl<R: GitRunner> Git<R> {
    pub fn with_runner(runner: R) -> Self {
        Self {
            runner,
            available: OnceCell::new(),
        }
    }

    async fn available(&self) -> bool {
        *self
            .available
            .get_or_init(|| async {
                let run = self.runner.run(&args(&["--version"]), Path::new(".")).await;
                let ok = !run.missing && run.code == 0;
                tracing::info!(target: "files.git", available = ok, "availability checked");
                ok
            })
            .await
    }

    async fn git(&self, root: &Path, rest: &[String]) -> GitRun {
        let mut argv: Vec<String> = SAFE_FLAGS.iter().map(|flag| (*flag).to_owned()).collect();
        argv.extend_from_slice(rest);
        self.runner.run(&argv, root).await
    }

    /// Where the project folder sits inside its repository, as git writes paths. None when it is not a repository.
    async fn prefix_of(&self, root: &Path) -> Option<String> {
        let result = self.git(root, &args(&["rev-parse", "--show-prefix"])).await;
        (result.code == 0).then(|| js::trim(&result.stdout).to_owned())
    }

    /// The overrides that blank every filter driver the repository defines. None when one cannot be overridden safely.
    async fn disarm_filters(&self, root: &Path) -> Option<Vec<String>> {
        let listed = self
            .git(
                root,
                &args(&[
                    "config",
                    "--name-only",
                    "--get-regexp",
                    r"^filter\..*\.(clean|smudge|process)$",
                ]),
            )
            .await;
        // Exit 1 is git's way of saying there are none.
        if listed.code != 0 {
            return Some(Vec::new());
        }
        filter_overrides(&listed.stdout)
    }

    /// Reads the branch and every changed file, scoped to the project folder.
    pub async fn status(&self, root: &Path) -> Result<RepoState, GitError> {
        if !self.available().await {
            return Ok(RepoState::NoGit);
        }
        let Some(prefix) = self.prefix_of(root).await else {
            return Ok(RepoState::NotRepo);
        };
        let Some(mut argv) = self.disarm_filters(root).await else {
            return Err(GitError::Refused);
        };
        argv.extend(args(&[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=normal",
            "--ignore-submodules=all",
            "--",
            ".",
        ]));

        let result = self.git(root, &argv).await;
        if result.code != 0 {
            tracing::error!(target: "files.git", subcommand = "status", code = result.code, stderrTail = tail_lines(&result.stderr).as_deref(), "status failed");
            return Err(GitError::Failed(first_line(&result.stderr)));
        }

        let status = parse_status(&result.stdout, &prefix);
        let counts = count_changes(&status.files);
        Ok(RepoState::Repo { status, counts })
    }

    /// The working-tree or staged diff of `relative` (or the whole project). `allow` drops guarded files by path, so a
    /// tracked credentials file never prints.
    pub async fn diff(
        &self,
        root: &Path,
        relative: &str,
        staged: bool,
        allow: impl Fn(&Path) -> bool,
    ) -> Result<Diff, GitError> {
        if !self.available().await {
            return Err(GitError::NotInstalled);
        }
        if self.prefix_of(root).await.is_none() {
            return Err(GitError::NotRepository);
        }
        let Some(disarmed) = self.disarm_filters(root).await else {
            return Err(GitError::Refused);
        };

        let mut common = disarmed;
        common.extend(args(&[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            "--relative",
        ]));
        if staged {
            common.push("--cached".to_owned());
        }

        let mut listing = common.clone();
        listing.extend(args(&["--name-only", "-z", "--"]));
        listing.push(if relative.is_empty() { "." } else { relative }.to_owned());
        let listed = self.git(root, &listing).await;
        if listed.code != 0 {
            tracing::error!(target: "files.git", subcommand = "diff", code = listed.code, stderrTail = tail_lines(&listed.stderr).as_deref(), "diff list failed");
            return Err(GitError::Failed(first_line(&listed.stderr)));
        }

        let changed: Vec<&str> = listed
            .stdout
            .split('\0')
            .filter(|name| !name.is_empty())
            .collect();
        let allowed: Vec<&str> = changed
            .iter()
            .copied()
            .filter(|name| allow(&root.join(name)))
            .collect();
        let skipped = changed.len() - allowed.len();
        if allowed.is_empty() {
            return Ok(Diff {
                diff: String::new(),
                truncated: false,
                staged,
                files: 0,
                skipped,
            });
        }

        let named = &allowed[..allowed.len().min(MAX_DIFF_FILES)];
        let mut content = common;
        content.push("--".to_owned());
        content.extend(named.iter().map(|name| (*name).to_owned()));
        let result = self.git(root, &content).await;
        if result.code != 0 {
            tracing::error!(target: "files.git", subcommand = "diff", code = result.code, files = named.len(), stderrTail = tail_lines(&result.stderr).as_deref(), "diff failed");
            return Err(GitError::Failed(first_line(&result.stderr)));
        }

        let too_long = js::utf16_len(&result.stdout) > MAX_DIFF_CHARS;
        let truncated = too_long || named.len() < allowed.len();
        let diff = if too_long {
            js::take_units(&result.stdout, MAX_DIFF_CHARS)
        } else {
            result.stdout
        };
        Ok(Diff {
            diff,
            truncated,
            staged,
            files: named.len(),
            skipped,
        })
    }
}

fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

/// The first line of git's complaint, or a fixed sentence when it said nothing.
fn first_line(text: &str) -> String {
    js_lines(js::trim(text))
        .first()
        .copied()
        .filter(|line| !line.is_empty())
        .unwrap_or("Git did not say what went wrong.")
        .to_owned()
}

/// The last three non-empty stderr lines joined with " | ", or None when there are none, as the failure log has them.
fn tail_lines(text: &str) -> Option<String> {
    let lines: Vec<&str> = js_lines(text)
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect();
    let tail = &lines[lines.len().saturating_sub(3)..];
    (!tail.is_empty()).then(|| tail.join(" | "))
}

/// Splits like `split(/\r?\n/)`: a carriage return is dropped only when a newline follows it, so a lone one stays.
fn js_lines(text: &str) -> Vec<&str> {
    let pieces: Vec<&str> = text.split('\n').collect();
    let last = pieces.len().saturating_sub(1);
    pieces
        .into_iter()
        .enumerate()
        .map(|(index, piece)| match piece.strip_suffix('\r') {
            Some(trimmed) if index < last => trimmed,
            _ => piece,
        })
        .collect()
}

/// The name in a `filter.<name>.(clean|smudge|process)` line, or None for any other line.
fn filter_name(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("filter.")?;
    ["clean", "smudge", "process"].iter().find_map(|kind| {
        let name = rest.strip_suffix(kind)?.strip_suffix('.')?;
        (!name.is_empty()).then_some(name)
    })
}

/// The `-c` overrides that blank the clean, smudge and process drivers of every name listed. None when a name holds
/// "=", since `-c key=value` would then override another key and leave the driver armed.
pub fn filter_overrides(listing: &str) -> Option<Vec<String>> {
    let mut names: Vec<&str> = Vec::new();
    for line in listing.split('\n') {
        if let Some(name) = filter_name(js::trim(line))
            && !names.contains(&name)
        {
            names.push(name);
        }
    }
    if names.iter().any(|name| name.contains('=')) {
        tracing::warn!(target: "files.git", filters = names.len(), "filter name refused");
        return None;
    }

    let mut flags = Vec::new();
    for name in names {
        for kind in ["clean", "smudge", "process"] {
            flags.push("-c".to_owned());
            flags.push(format!("filter.{name}.{kind}="));
        }
    }
    Some(flags)
}

/// The kind a porcelain entry describes: its type character and its two-letter status.
fn kind_of(type_char: Option<char>, xy: &str) -> Kind {
    match type_char {
        Some('?') => Kind::Untracked,
        Some('u') => Kind::Conflicted,
        Some('2') => Kind::Renamed,
        _ => {
            let text = if xy.is_empty() { ".." } else { xy };
            let mut letters = text.chars();
            let index = letters.next();
            let worktree = letters.next();
            if index == Some('A') || worktree == Some('A') {
                Kind::Added
            } else if index == Some('D') || worktree == Some('D') {
                Kind::Deleted
            } else {
                Kind::Modified
            }
        }
    }
}

/// `# branch.ab +N -M`, read strictly: ASCII digits only, nothing after.
fn parse_ahead_behind(value: &str) -> Option<(u64, u64)> {
    let rest = value.strip_prefix('+')?;
    let (ahead, behind) = rest.split_once(" -")?;
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(ahead) || !digits(behind) {
        return None;
    }
    Some((ahead.parse().ok()?, behind.parse().ok()?))
}

fn apply_header(result: &mut Status, header: &str) {
    let (key, value) = header.split_once(' ').unwrap_or((header, ""));
    match key {
        "branch.head" => {
            result.detached = value == "(detached)";
            result.branch = (!result.detached).then(|| value.to_owned());
        }
        "branch.upstream" => result.upstream = Some(value.to_owned()),
        "branch.ab" => {
            if let Some((ahead, behind)) = parse_ahead_behind(value) {
                result.ahead = ahead;
                result.behind = behind;
            }
        }
        _ => {}
    }
}

/// The text of a field after the first `skip` space-separated fields, rejoined with spaces so a path keeps its spaces.
fn path_after(fields: &[&str], skip: usize) -> String {
    fields
        .get(skip..)
        .map(|rest| rest.join(" "))
        .unwrap_or_default()
}

fn strip_prefix_of(file: &str, prefix: &str) -> String {
    if !prefix.is_empty() && file.starts_with(prefix) {
        file[prefix.len()..].to_owned()
    } else {
        file.to_owned()
    }
}

/// Reads `git status --porcelain=v2 --branch -z`. Entries are NUL-separated and never quoted, so a file called "a b"
/// parses like any other. `prefix` is the project's place inside the repository, removed from each path.
pub fn parse_status(output: &str, prefix: &str) -> Status {
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut result = Status::default();
    let mut index = 0;

    while let Some(token) = tokens.get(index).copied() {
        let position = index;
        index += 1;
        if token.is_empty() {
            continue;
        }
        if let Some(header) = token.strip_prefix("# ") {
            apply_header(&mut result, header);
            continue;
        }

        let type_char = token.chars().next();
        let fields: Vec<&str> = token.split(' ').collect();
        let (xy, path, from) = match type_char {
            Some('1') => (fields.get(1).copied(), path_after(&fields, 8), None),
            Some('2') => {
                // The path it came from is the next NUL-separated field, which the loop must not read again.
                index += 1;
                let from = tokens
                    .get(position + 1)
                    .copied()
                    .filter(|name| !name.is_empty());
                (fields.get(1).copied(), path_after(&fields, 9), from)
            }
            Some('u') => (fields.get(1).copied(), path_after(&fields, 10), None),
            Some('?') => (Some("??"), token.get(2..).unwrap_or("").to_owned(), None),
            _ => continue,
        };
        if path.is_empty() {
            continue;
        }
        if result.files.len() >= MAX_STATUS_FILES {
            result.truncated = true;
            continue;
        }

        let xy = xy.unwrap_or("..");
        let mut letters = xy.chars();
        let x = letters.next();
        let y = letters.next();
        result.files.push(FileChange {
            path: strip_prefix_of(&path, prefix),
            from: from.map(|name| strip_prefix_of(name, prefix)),
            kind: kind_of(type_char, xy),
            staged: type_char != Some('?') && x != Some('.'),
            unstaged: type_char == Some('?') || y != Some('.'),
        });
    }

    result
}

/// How many files of each kind changed.
pub fn count_changes(files: &[FileChange]) -> Counts {
    let mut counts = Counts::default();
    for file in files {
        match file.kind {
            Kind::Modified => counts.modified += 1,
            Kind::Added => counts.added += 1,
            Kind::Deleted => counts.deleted += 1,
            Kind::Renamed => counts.renamed += 1,
            Kind::Untracked => counts.untracked += 1,
            Kind::Conflicted => counts.conflicted += 1,
        }
    }
    counts
}

/// A path the model named, as git should see it: relative to the project, with forward slashes. None when it lies
/// outside the project.
pub fn to_pathspec(root: &Path, absolute: &Path) -> Option<String> {
    let relative = relative_text(root, absolute);
    // TS quirk: git.cjs refuses any relative path that starts with "..", so a name such as "..notes" is refused too.
    if relative.starts_with("..") {
        return None;
    }
    Some(if relative.is_empty() {
        ".".to_owned()
    } else {
        relative
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use crate::fs_guard::Guard;

    async fn git_available() -> bool {
        spawn::exec_hidden("git", &["--version"], |_| {})
            .await
            .is_ok_and(|output| output.status.success())
    }

    /// Runs git in a repository for setup, with an identity so commits work anywhere.
    async fn git_in(root: &Path, rest: &[&str]) {
        let mut argv = vec!["-c", "user.email=t@t", "-c", "user.name=t"];
        argv.extend_from_slice(rest);
        let output = spawn::exec_hidden("git", &argv, |command| {
            command.current_dir(root);
        })
        .await
        .expect("git starts");
        assert!(output.status.success(), "git {rest:?} failed");
    }

    fn write(root: &Path, name: &str, text: &str) {
        let path = root.join(name);
        fs::create_dir_all(path.parent().expect("parent")).expect("folders");
        fs::write(path, text).expect("file writes");
    }

    /// A repository with one commit: readme.md and src/app.ts.
    async fn repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = fs::canonicalize(dir.path()).expect("real path");
        git_in(&root, &["init", "-q", "-b", "main", "."]).await;
        write(&root, "readme.md", "hello\n");
        write(&root, "src/app.ts", "export const a = 1;\n");
        git_in(&root, &["add", "."]).await;
        git_in(&root, &["commit", "-q", "-m", "first"]).await;
        (dir, root)
    }

    fn repo_status(state: RepoState) -> (Status, Counts) {
        match state {
            RepoState::Repo { status, counts } => (status, counts),
            other => panic!("expected a repository, got {other:?}"),
        }
    }

    #[test]
    fn a_status_header_gives_the_branch_and_its_distance() {
        let output = [
            "# branch.oid 1234",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "",
        ]
        .join("\0");

        let status = parse_status(&output, "");
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 1));
        assert!(status.files.is_empty());
    }

    #[test]
    fn a_detached_head_is_not_a_branch() {
        let status = parse_status("# branch.head (detached)\0", "");
        assert!(status.detached);
        assert_eq!(status.branch, None);
    }

    #[test]
    fn changes_sort_into_kinds_with_staged_and_unstaged_apart() {
        let output = [
            "1 .M N... 100644 100644 100644 aaa bbb src/app.ts",
            "1 A. N... 000000 100644 100644 000 ccc src/new file.ts",
            "1 D. N... 100644 000000 000000 ddd 000 old.ts",
            "2 R. N... 100644 100644 100644 eee fff R100 docs/guide.md",
            "guide.md",
            "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
            "? notes.md",
            "",
        ]
        .join("\0");

        let files = parse_status(&output, "").files;
        let shape: Vec<(&str, Option<&str>, Kind, bool, bool)> = files
            .iter()
            .map(|file| {
                (
                    file.path.as_str(),
                    file.from.as_deref(),
                    file.kind,
                    file.staged,
                    file.unstaged,
                )
            })
            .collect();
        assert_eq!(
            shape,
            vec![
                ("src/app.ts", None, Kind::Modified, false, true),
                ("src/new file.ts", None, Kind::Added, true, false),
                ("old.ts", None, Kind::Deleted, true, false),
                (
                    "docs/guide.md",
                    Some("guide.md"),
                    Kind::Renamed,
                    true,
                    false
                ),
                ("conflict.ts", None, Kind::Conflicted, true, true),
                ("notes.md", None, Kind::Untracked, false, true),
            ]
        );
    }

    #[test]
    fn paths_are_relative_to_a_project_inside_a_bigger_repository() {
        let output = "1 .M N... 100644 100644 100644 a b app/src/main.ts\0? app/readme.md\0";
        let paths: Vec<String> = parse_status(output, "app/")
            .files
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert_eq!(paths, ["src/main.ts", "readme.md"]);
    }

    #[test]
    fn listing_stops_at_the_limit_and_says_so() {
        let many: Vec<String> = (0..MAX_STATUS_FILES + 5)
            .map(|i| format!("? f{i}.txt"))
            .collect();
        let status = parse_status(&many.join("\0"), "");
        assert_eq!(status.files.len(), MAX_STATUS_FILES);
        assert!(status.truncated);
    }

    #[test]
    fn a_driver_name_with_an_equals_sign_refuses_the_whole_listing() {
        assert_eq!(filter_overrides("filter.a=b.clean\n"), None);
        assert_eq!(
            filter_overrides("filter.lfs.clean\nfilter.lfs.process\nfilter.evil.clean\n")
                .map(|flags| flags.len()),
            Some(12)
        );
        assert_eq!(filter_name("filter..clean"), None);
        assert_eq!(filter_name("filter.x.clean.smudge"), Some("x.clean"));
    }

    #[test]
    fn a_pathspec_is_relative_with_forward_slashes() {
        let root = Path::new("/work/project");
        assert_eq!(
            to_pathspec(root, Path::new("/work/project/src/app.ts")).as_deref(),
            Some("src/app.ts")
        );
        assert_eq!(to_pathspec(root, root).as_deref(), Some("."));
        assert_eq!(to_pathspec(root, Path::new("/work/other/file.ts")), None);
    }

    #[test]
    fn counts_add_up_by_kind() {
        let files = vec![
            FileChange {
                path: "a".into(),
                from: None,
                kind: Kind::Modified,
                staged: false,
                unstaged: true,
            },
            FileChange {
                path: "b".into(),
                from: None,
                kind: Kind::Modified,
                staged: false,
                unstaged: true,
            },
            FileChange {
                path: "c".into(),
                from: None,
                kind: Kind::Untracked,
                staged: false,
                unstaged: true,
            },
        ];
        let counts = count_changes(&files);
        assert_eq!((counts.modified, counts.untracked, counts.added), (2, 1, 0));
    }

    #[tokio::test]
    async fn a_clean_tree_reports_its_branch_and_nothing_else() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;

        let (status, counts) = repo_status(Git::default().status(&root).await.expect("status"));
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert!(status.files.is_empty());
        assert_eq!(counts, Counts::default());
    }

    #[tokio::test]
    async fn an_edit_a_new_file_and_a_staged_file_are_all_seen() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        write(&root, "readme.md", "hello again\n");
        write(&root, "notes.md", "new\n");
        write(&root, "src/staged.ts", "export {};\n");
        git_in(&root, &["add", "src/staged.ts"]).await;

        let (status, _) = repo_status(Git::default().status(&root).await.expect("status"));
        let find = |path: &str| status.files.iter().find(|file| file.path == path).cloned();
        assert_eq!(
            find("readme.md").map(|file| file.kind),
            Some(Kind::Modified)
        );
        assert_eq!(
            find("notes.md").map(|file| file.kind),
            Some(Kind::Untracked)
        );
        assert_eq!(
            find("src/staged.ts").map(|file| (file.kind, file.staged)),
            Some((Kind::Added, true))
        );
    }

    #[tokio::test]
    async fn a_diff_of_one_file_shows_both_sides_of_the_change() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        write(&root, "src/app.ts", "export const a = 2;\n");

        let diff = Git::default()
            .diff(&root, "src/app.ts", false, |_| true)
            .await
            .expect("diff");
        assert!(diff.diff.contains("-export const a = 1;"));
        assert!(diff.diff.contains("+export const a = 2;"));
        assert_eq!(diff.files, 1);
    }

    #[tokio::test]
    async fn a_project_inside_the_repository_sees_only_its_own_files() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        write(&root, "readme.md", "outside\n");
        write(&root, "src/app.ts", "export const a = 3;\n");

        let (status, _) = repo_status(
            Git::default()
                .status(&root.join("src"))
                .await
                .expect("status"),
        );
        let paths: Vec<String> = status.files.into_iter().map(|file| file.path).collect();
        assert_eq!(paths, ["app.ts"]);
    }

    #[tokio::test]
    async fn a_tracked_credentials_file_stays_out_of_a_whole_project_diff() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        write(&root, ".env", "TOKEN=old\n");
        git_in(&root, &["add", ".env"]).await;
        git_in(&root, &["commit", "-q", "-m", "env"]).await;
        write(&root, ".env", "TOKEN=super-secret\n");
        write(&root, "readme.md", "changed\n");

        let guard = Guard::default();
        let diff = Git::default()
            .diff(&root, ".", false, |absolute| guard.is_readable(absolute))
            .await
            .expect("diff");
        assert!(diff.diff.contains("+changed"));
        assert!(!diff.diff.contains("super-secret"));
        assert_eq!(diff.skipped, 1);
    }

    /// A script that leaves a marker file behind whenever git runs it.
    fn trap(root: &Path) -> (PathBuf, String) {
        let marker = root.join("RAN");
        let script = root.join("trap.sh");
        let body = format!("#!/bin/sh\necho ran > \"{}\"\ncat\n", marker.display());
        fs::write(&script, body).expect("script writes");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755))
            .expect("script is executable");
        (marker, script.display().to_string())
    }

    #[tokio::test]
    async fn a_repositorys_fsmonitor_hook_never_runs() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        let (marker, script) = trap(&root);
        git_in(&root, &["config", "core.fsmonitor", &script]).await;
        write(&root, "readme.md", "changed\n");

        // The control: plain git does run the hook, so the check below means something.
        let control = spawn::exec_hidden("git", &["status", "--porcelain"], |command| {
            command.current_dir(&root);
        })
        .await
        .expect("git starts");
        assert!(control.status.success());
        assert!(marker.exists());
        fs::remove_file(&marker).expect("marker removed");

        Git::default().status(&root).await.expect("status");
        assert!(!marker.exists());
    }

    #[tokio::test]
    async fn a_repositorys_clean_filter_never_runs_on_status_or_diff() {
        if !git_available().await {
            eprintln!("skipping: git is not installed");
            return;
        }
        let (_dir, root) = repo().await;
        let (marker, script) = trap(&root);
        write(&root, ".gitattributes", "readme.md filter=evil\n");
        git_in(&root, &["add", ".gitattributes"]).await;
        git_in(&root, &["commit", "-q", "-m", "attributes"]).await;
        git_in(&root, &["config", "filter.evil.clean", &script]).await;
        write(&root, "readme.md", "changed\n");

        let control = spawn::exec_hidden(
            "git",
            &[
                "-c",
                "core.fsmonitor=false",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
            ],
            |command| {
                command.current_dir(&root);
            },
        )
        .await
        .expect("git starts");
        assert!(control.status.success());
        assert!(marker.exists());
        fs::remove_file(&marker).expect("marker removed");

        let git = Git::default();
        git.status(&root).await.expect("status");
        git.diff(&root, ".", false, |_| true)
            .await
            .expect("whole diff");
        git.diff(&root, "readme.md", false, |_| true)
            .await
            .expect("one file");
        assert!(!marker.exists());
    }
}
