//! Git for the app, run through core's hidden runner. Reads never take locks; writes are stage, unstage,
//! commit and switching branch, and never fetch or push. Every call carries the safe flags and disarms the
//! repository's filter drivers, since repo config can run programs.

use std::path::Path;
use std::time::Instant;

use draggy_diagnostics::{Diagnostics, TimeOptions};
use draggy_tools::git::{
    self, GitRun, GitRunner, MAX_DIFF_CHARS, MAX_DIFF_FILES, SAFE_FLAGS, SpawnRunner,
};
use serde_json::{Value, json};
use tokio::sync::OnceCell;

const SCOPE: &str = "files.git";
const MAX_UNTRACKED_DIFFS: usize = 20;
const MAX_LOG_ENTRIES: usize = 200;
const MAX_COMMIT_MESSAGE_UNITS: usize = 10_000;
const REFUSED: &str =
    "This repository's configuration could run programs, so Draggy will not read it.";
const NOT_INSTALLED: &str = "Git is not installed.";
const NO_NAMES: &str = "No files were named.";
const NOT_A_BRANCH: &str = "That is not a branch name.";

/// The git calls for one process. Remembers whether git exists, since that does not change while Draggy runs.
pub struct Git<R = SpawnRunner> {
    runner: R,
    available: OnceCell<bool>,
}

/// What a diff call asks for, as the renderer named it. `relative` is already a checked pathspec.
pub struct DiffOptions<'a> {
    pub relative: &'a str,
    pub staged: bool,
    pub untracked: bool,
    pub ignore_whitespace: bool,
}

#[derive(Default)]
struct Added {
    text: String,
    files: usize,
    more: bool,
}

fn fail(error: impl Into<String>) -> Value {
    json!({ "success": false, "error": error.into() })
}

fn words(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

impl<R: GitRunner> Git<R> {
    pub fn new(runner: R) -> Self {
        Self {
            runner,
            available: OnceCell::new(),
        }
    }

    /// One git call with the safe flags first.
    async fn git(&self, diag: &Diagnostics, root: &Path, rest: Vec<String>) -> GitRun {
        let mut argv = words(&SAFE_FLAGS);
        argv.extend(rest);
        self.spawn_logged(diag, root, argv).await
    }

    /// Runs one process and writes the `proc.spawn` lines the Electron build writes.
    async fn spawn_logged(&self, diag: &Diagnostics, root: &Path, argv: Vec<String>) -> GitRun {
        let cwd = root.display().to_string();
        diag.info(
            "proc.spawn",
            "spawned",
            Some(json!({ "bin": "git", "args": shown(&argv), "cwd": cwd })),
        );
        let started = Instant::now();
        let run = self.runner.run(&argv, root).await;
        let data = json!({ "bin": "git", "code": run.code, "durMs": started.elapsed().as_millis() as u64 });
        if run.code == 0 {
            diag.info("proc.spawn", "git exited", Some(data));
        } else {
            diag.warn("proc.spawn", "git exited", Some(data));
        }
        run
    }

    async fn available(&self, diag: &Diagnostics) -> bool {
        *self
            .available
            .get_or_init(|| async {
                let run = self
                    .spawn_logged(diag, Path::new("."), words(&["--version"]))
                    .await;
                let ok = !run.missing && run.code == 0;
                diag.info(
                    SCOPE,
                    "availability checked",
                    Some(json!({ "available": ok })),
                );
                ok
            })
            .await
    }

    async fn prefix_of(&self, diag: &Diagnostics, root: &Path) -> Option<String> {
        let result = self
            .git(diag, root, words(&["rev-parse", "--show-prefix"]))
            .await;
        (result.code == 0).then(|| result.stdout.trim().to_owned())
    }

    /// Filter overrides for every driver the repository defines. None when a name cannot be overridden safely.
    async fn disarm(&self, diag: &Diagnostics, root: &Path) -> Option<Vec<String>> {
        let listed = self
            .git(
                diag,
                root,
                words(&[
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
        let flags = git::filter_overrides(&listed.stdout);
        if flags.is_none() {
            let names = listed
                .stdout
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count();
            diag.warn(
                SCOPE,
                "filter name refused",
                Some(json!({ "filters": names })),
            );
        }
        flags
    }

    pub async fn status(&self, diag: &Diagnostics, root: &Path) -> Value {
        if !self.available(diag).await {
            return json!({ "success": true, "available": false, "isRepo": false });
        }
        let Some(prefix) = self.prefix_of(diag, root).await else {
            return json!({ "success": true, "available": true, "isRepo": false });
        };
        let Some(disarmed) = self.disarm(diag, root).await else {
            return json!({ "success": false, "available": true, "isRepo": true, "error": REFUSED });
        };

        let mut timer = diag.time(SCOPE, "status", None, TimeOptions::default());
        let mut rest = disarmed;
        rest.extend(words(&[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=normal",
            "--ignore-submodules=all",
            "--",
            ".",
        ]));
        let result = self.git(diag, root, rest).await;
        if result.code != 0 {
            diag.error(
                SCOPE,
                "status failed",
                Some(json!({ "subcommand": "status", "code": result.code, "stderrTail": tail_lines(&result.stderr, 3) })),
            );
            return json!({ "success": false, "available": true, "isRepo": true, "error": first_line(&result.stderr) });
        }

        let parsed = git::parse_status(&result.stdout, &prefix);
        let counts = git::count_changes(&parsed.files);
        timer.end(Some(
            json!({ "files": parsed.files.len(), "truncated": parsed.truncated }),
        ));

        let mut out = json!({ "success": true, "available": true, "isRepo": true });
        if let (Value::Object(base), Ok(Value::Object(fields))) =
            (&mut out, serde_json::to_value(&parsed))
        {
            base.extend(fields);
        }
        if let (Value::Object(base), Ok(counts)) = (&mut out, serde_json::to_value(&counts)) {
            base.insert("counts".to_owned(), counts);
        }
        out
    }

    /// Working-tree or staged diff of `opts.relative`. `allow` drops guarded files by path so a tracked
    /// credentials file never prints.
    pub async fn diff(
        &self,
        diag: &Diagnostics,
        root: &Path,
        opts: &DiffOptions<'_>,
        allow: &(dyn Fn(&Path) -> bool + Sync),
    ) -> Value {
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        if self.prefix_of(diag, root).await.is_none() {
            return fail("This folder is not a git repository.");
        }
        let Some(disarmed) = self.disarm(diag, root).await else {
            return fail(REFUSED);
        };

        let mut timer = diag.time(
            SCOPE,
            "diff",
            Some(json!({ "staged": opts.staged })),
            TimeOptions::default(),
        );
        let mut common = disarmed;
        common.extend(words(&[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            "--relative",
        ]));
        if opts.ignore_whitespace {
            common.push("-w".to_owned());
        }
        if opts.staged {
            common.push("--cached".to_owned());
        }

        let relative = if opts.relative.is_empty() {
            "."
        } else {
            opts.relative
        };
        let mut listing = common.clone();
        listing.extend(words(&["--name-only", "-z", "--"]));
        listing.push(relative.to_owned());
        let listed = self.git(diag, root, listing).await;
        if listed.code != 0 {
            diag.error(
                SCOPE,
                "diff list failed",
                Some(json!({ "subcommand": "diff", "code": listed.code, "stderrTail": tail_lines(&listed.stderr, 3) })),
            );
            return fail(first_line(&listed.stderr));
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
        let added = if !opts.staged && opts.untracked {
            self.untracked_diff(diag, root, relative, allow).await
        } else {
            Added::default()
        };

        if allowed.is_empty() {
            timer.end(Some(json!({ "files": added.files, "skipped": skipped })));
            let text = clip_diff(&added.text);
            return json!({
                "success": true,
                "diff": text,
                "truncated": added.more || text.len() < added.text.len(),
                "staged": opts.staged,
                "files": added.files,
                "skipped": skipped,
            });
        }

        let named: Vec<String> = allowed
            .iter()
            .take(MAX_DIFF_FILES)
            .map(|name| (*name).to_owned())
            .collect();
        let mut rest = common;
        rest.push("--".to_owned());
        rest.extend(named.iter().cloned());
        let result = self.git(diag, root, rest).await;
        if result.code != 0 {
            diag.error(
                SCOPE,
                "diff failed",
                Some(json!({ "subcommand": "diff", "code": result.code, "files": named.len(), "stderrTail": tail_lines(&result.stderr, 3) })),
            );
            return fail(first_line(&result.stderr));
        }

        let mut whole = result.stdout.clone();
        if !result.stdout.is_empty() && !added.text.is_empty() && !result.stdout.ends_with('\n') {
            whole.push('\n');
        }
        whole.push_str(&added.text);
        let text = clip_diff(&whole);
        let truncated = text.len() < whole.len() || named.len() < allowed.len() || added.more;
        let files = named.len() + added.files;
        timer.end(Some(json!({
            "files": files,
            "skipped": skipped,
            "chars": whole.encode_utf16().count(),
            "truncated": truncated,
        })));

        json!({ "success": true, "diff": text, "truncated": truncated, "staged": opts.staged, "files": files, "skipped": skipped })
    }

    /// New files as additions, since `git diff` does not list files git does not know yet.
    async fn untracked_diff(
        &self,
        diag: &Diagnostics,
        root: &Path,
        relative: &str,
        allow: &(dyn Fn(&Path) -> bool + Sync),
    ) -> Added {
        let mut listing = words(&["ls-files", "--others", "--exclude-standard", "-z", "--"]);
        listing.push(relative.to_owned());
        let listed = self.git(diag, root, listing).await;
        if listed.code != 0 {
            return Added::default();
        }

        let names: Vec<&str> = listed
            .stdout
            .split('\0')
            .filter(|name| !name.is_empty())
            .filter(|name| allow(&root.join(name)))
            .collect();
        let mut added = Added::default();
        for name in names.iter().take(MAX_UNTRACKED_DIFFS) {
            let mut argv = words(&[
                "diff",
                "--no-index",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                "/dev/null",
            ]);
            argv.push((*name).to_owned());
            // Exit 1 is how --no-index says the two sides differ.
            let result = self.git(diag, root, argv).await;
            if result.code > 1 || result.stdout.is_empty() {
                continue;
            }
            added.text.push_str(&result.stdout);
            if !result.stdout.ends_with('\n') {
                added.text.push('\n');
            }
            added.files += 1;
        }
        added.more = names.len() > MAX_UNTRACKED_DIFFS;
        added
    }

    /// The latest commits on the current branch, or on every branch with `all`, with parents and refs.
    pub async fn log(
        &self,
        diag: &Diagnostics,
        root: &Path,
        limit: Option<f64>,
        all: bool,
    ) -> Value {
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        let count = log_count(limit);
        let mut argv = words(&["log"]);
        argv.push(format!("-n{count}"));
        argv.extend(words(&[
            "--topo-order",
            "--no-show-signature",
            "--decorate=short",
        ]));
        if all {
            argv.push("--all".to_owned());
        }
        argv.push("--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%P%x1f%D%x1e".to_owned());

        let result = self.git(diag, root, argv).await;
        if result.code != 0 {
            // A repository with no commits yet has no log, which is not an error.
            if result
                .stderr
                .to_lowercase()
                .contains("does not have any commits")
            {
                return json!({ "success": true, "commits": [] });
            }
            return fail(first_line(&result.stderr));
        }

        let commits: Vec<Value> = result
            .stdout
            .split('\x1e')
            .map(|record| {
                record
                    .strip_prefix("\r\n")
                    .or_else(|| record.strip_prefix('\n'))
                    .unwrap_or(record)
            })
            .filter(|record| !record.is_empty())
            .map(|record| {
                let fields: Vec<&str> = record.split('\x1f').collect();
                let field = |index: usize| fields.get(index).copied().unwrap_or("");
                let parents: Vec<&str> = field(5)
                    .split(' ')
                    .filter(|part| !part.is_empty())
                    .collect();
                json!({
                    "hash": field(0),
                    "short": field(1),
                    "author": field(2),
                    "date": field(3),
                    "subject": field(4),
                    "parents": parents,
                    "refs": ref_list(field(6)),
                })
            })
            .collect();
        json!({ "success": true, "commits": commits })
    }

    /// The changes one commit made, against its first parent. `allow` drops guarded files by path.
    pub async fn show(
        &self,
        diag: &Diagnostics,
        root: &Path,
        hash: &str,
        ignore_whitespace: bool,
        allow: &(dyn Fn(&Path) -> bool + Sync),
    ) -> Value {
        let rev = hash.trim();
        if !is_hash(rev) {
            return fail("That is not a commit.");
        }
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        let Some(disarmed) = self.disarm(diag, root).await else {
            return fail(REFUSED);
        };

        let mut common = disarmed;
        common.extend(words(&[
            "show",
            "--format=",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            "--diff-merges=first-parent",
            "--relative",
        ]));
        if ignore_whitespace {
            common.push("-w".to_owned());
        }

        let mut listing = common.clone();
        listing.extend(words(&["--name-only", "-z"]));
        listing.push(rev.to_owned());
        listing.push("--".to_owned());
        let listed = self.git(diag, root, listing).await;
        if listed.code != 0 {
            return fail(first_line(&listed.stderr));
        }

        let changed: Vec<&str> = listed
            .stdout
            .split('\0')
            .map(|name| name.trim_start_matches('\n'))
            .filter(|name| !name.is_empty())
            .collect();
        let allowed: Vec<&str> = changed
            .iter()
            .copied()
            .filter(|name| allow(&root.join(name)))
            .collect();
        let skipped = changed.len() - allowed.len();
        if allowed.is_empty() {
            return json!({ "success": true, "diff": "", "truncated": false, "files": 0, "skipped": skipped });
        }

        let named: Vec<String> = allowed
            .iter()
            .take(MAX_DIFF_FILES)
            .map(|name| (*name).to_owned())
            .collect();
        let mut argv = common;
        argv.push(rev.to_owned());
        argv.push("--".to_owned());
        argv.extend(named.iter().cloned());
        let result = self.git(diag, root, argv).await;
        if result.code != 0 {
            return fail(first_line(&result.stderr));
        }
        let text = clip_diff(&result.stdout);
        let truncated = text.len() < result.stdout.len() || named.len() < allowed.len();
        json!({ "success": true, "diff": text, "truncated": truncated, "files": named.len(), "skipped": skipped })
    }

    /// Local branches, the current one marked.
    pub async fn branches(&self, diag: &Diagnostics, root: &Path) -> Value {
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        let result = self
            .git(
                diag,
                root,
                words(&[
                    "for-each-ref",
                    "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)",
                    "refs/heads",
                ]),
            )
            .await;
        if result.code != 0 {
            return fail(first_line(&result.stderr));
        }
        let list: Vec<Value> = result
            .stdout
            .split(['\r', '\n'])
            .filter(|line| !line.is_empty())
            .map(|line| {
                let fields: Vec<&str> = line.split('\x1f').collect();
                let head = fields.first().copied().unwrap_or("");
                let name = fields.get(1).copied().unwrap_or("");
                let upstream = fields.get(2).copied().unwrap_or("");
                let mut item = json!({ "name": name, "current": head == "*" });
                if !upstream.is_empty() {
                    item["upstream"] = json!(upstream);
                }
                item
            })
            .collect();
        json!({ "success": true, "branches": list })
    }

    /// Moves files into the next commit. Paths were checked by the caller.
    pub async fn stage(&self, diag: &Diagnostics, root: &Path, paths: &[String]) -> Value {
        let named = path_list(paths);
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        if named.is_empty() {
            return fail(NO_NAMES);
        }
        let mut argv = words(&["add", "--"]);
        argv.extend(named.iter().cloned());
        let result = self.git(diag, root, argv).await;
        if result.code == 0 {
            json!({ "success": true, "files": named.len() })
        } else {
            fail(first_line(&result.stderr))
        }
    }

    /// Takes files back out of the next commit, leaving the working tree as it is.
    pub async fn unstage(&self, diag: &Diagnostics, root: &Path, paths: &[String]) -> Value {
        let named = path_list(paths);
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        if named.is_empty() {
            return fail(NO_NAMES);
        }
        // A repository with no commits has no HEAD to restore from; rm --cached does the same job.
        let has_head = self
            .git(diag, root, words(&["rev-parse", "--verify", "-q", "HEAD"]))
            .await
            .code
            == 0;
        let mut argv = if has_head {
            words(&["restore", "--staged", "--"])
        } else {
            words(&["rm", "--cached", "-r", "-q", "--"])
        };
        argv.extend(named.iter().cloned());
        let result = self.git(diag, root, argv).await;
        if result.code == 0 {
            json!({ "success": true, "files": named.len() })
        } else {
            fail(first_line(&result.stderr))
        }
    }

    /// Commits what is staged. Hooks stay off: they are programs the repository chose.
    pub async fn commit(&self, diag: &Diagnostics, root: &Path, message: &str) -> Value {
        let text = message.trim();
        if text.is_empty() {
            return fail("A commit needs a message.");
        }
        if text.encode_utf16().count() > MAX_COMMIT_MESSAGE_UNITS {
            return fail("The commit message is too long.");
        }
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }

        let mut argv = words(&[
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "-m",
        ]);
        argv.push(text.to_owned());
        let result = self.git(diag, root, argv).await;
        if result.code != 0 {
            diag.error(
                SCOPE,
                "commit failed",
                Some(json!({ "subcommand": "commit", "code": result.code, "stderrTail": tail_lines(&result.stderr, 3) })),
            );
            let detail = if result.stderr.is_empty() {
                &result.stdout
            } else {
                &result.stderr
            };
            return fail(first_line(detail));
        }
        let head = self
            .git(diag, root, words(&["rev-parse", "--short", "HEAD"]))
            .await;
        let hash = (head.code == 0).then(|| head.stdout.trim().to_owned());
        json!({ "success": true, "hash": hash })
    }

    /// Switches to an existing local branch. Git refuses when uncommitted changes would be lost.
    pub async fn checkout(&self, diag: &Diagnostics, root: &Path, branch: &str) -> Value {
        let name = branch.trim();
        if name.is_empty() || name.starts_with('-') {
            return fail(NOT_A_BRANCH);
        }
        if !self.available(diag).await {
            return fail(NOT_INSTALLED);
        }
        let valid = self
            .git(diag, root, words(&["check-ref-format", "--branch", name]))
            .await;
        if valid.code != 0 {
            return fail(NOT_A_BRANCH);
        }
        let result = self
            .git(diag, root, words(&["switch", "--no-guess", name]))
            .await;
        if result.code == 0 {
            json!({ "success": true, "branch": name })
        } else {
            fail(first_line(&result.stderr))
        }
    }
}

/// The argument list as the log shows it: the commit message is never written out.
fn shown(argv: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(argv.len());
    let mut hide_next = false;
    for arg in argv {
        if hide_next {
            out.push("<message>".to_owned());
            hide_next = false;
            continue;
        }
        hide_next = arg == "-m";
        out.push(arg.clone());
    }
    out
}

/// The `limit` a log call gets: Math.trunc of it, 50 when that is 0 or not a number, held to 1..=200.
fn log_count(limit: Option<f64>) -> usize {
    let truncated = limit.map(f64::trunc).unwrap_or(f64::NAN);
    let value = if truncated.is_nan() || truncated == 0.0 {
        50.0
    } else {
        truncated
    };
    value.clamp(1.0, MAX_LOG_ENTRIES as f64) as usize
}

fn is_hash(text: &str) -> bool {
    (4..=64).contains(&text.len()) && text.chars().all(|c| c.is_ascii_hexdigit())
}

/// The names in a `%D` decoration: "HEAD -> main, origin/main, tag: v1" gives each ref with its kind.
fn ref_list(text: &str) -> Vec<Value> {
    text.split(", ")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            if let Some(name) = part.strip_prefix("HEAD -> ") {
                json!({ "name": name, "kind": "head" })
            } else if part == "HEAD" {
                json!({ "name": "HEAD", "kind": "head" })
            } else if let Some(name) = part.strip_prefix("tag: ") {
                json!({ "name": name, "kind": "tag" })
            } else if part.contains('/') {
                json!({ "name": part, "kind": "remote" })
            } else {
                json!({ "name": part, "kind": "branch" })
            }
        })
        .collect()
}

fn path_list(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| !path.is_empty())
        .cloned()
        .collect()
}

/// Cuts a diff at the last whole line within the character budget, so a cut never ends in half a line.
pub fn clip_diff(text: &str) -> String {
    if text.encode_utf16().count() <= MAX_DIFF_CHARS {
        return text.to_owned();
    }
    let mut units = 0;
    let mut end = text.len();
    for (index, c) in text.char_indices() {
        units += c.len_utf16();
        if units > MAX_DIFF_CHARS {
            end = index;
            break;
        }
    }
    let cut = &text[..end];
    match cut.rfind('\n') {
        Some(newline) if newline > 0 => cut[..=newline].to_owned(),
        _ => cut.to_owned(),
    }
}

/// The last few stderr lines, for a failure log. Git's own messages hold no file contents.
fn tail_lines(text: &str, count: usize) -> Option<String> {
    let lines: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
    let start = lines.len().saturating_sub(count);
    let joined = lines[start..].join(" | ");
    (!joined.is_empty()).then_some(joined)
}

/// The first line of git's message, with a fixed fallback when git said nothing.
fn first_line(text: &str) -> String {
    text.trim()
        .lines()
        .next()
        .filter(|line| !line.is_empty())
        .unwrap_or("Git did not say what went wrong.")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use draggy_diagnostics::{Config, SystemClock};
    use std::path::PathBuf;
    use std::sync::Arc;

    fn diag(dir: &Path) -> Diagnostics {
        let config = Config::from_env(|_| None, "test", 1, true, None);
        Diagnostics::open(dir, config, Arc::new(SystemClock::default()))
    }

    async fn run(root: &Path, args: &[&str]) {
        let mut argv: Vec<String> = vec![
            "-c".into(),
            "user.email=t@t".into(),
            "-c".into(),
            "user.name=t".into(),
        ];
        argv.extend(args.iter().map(|arg| (*arg).to_owned()));
        let result = SpawnRunner.run(&argv, root).await;
        assert_eq!(result.code, 0, "setup git {args:?}: {}", result.stderr);
    }

    fn write(root: &Path, name: &str, text: &str) {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A repository with one commit, a readme and a source file, as the Electron suite builds it.
    async fn repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        let root = std::fs::canonicalize(&root).unwrap();
        run(&root, &["init", "-q", "-b", "main", "."]).await;
        run(&root, &["config", "user.email", "t@t"]).await;
        run(&root, &["config", "user.name", "t"]).await;
        write(&root, "readme.md", "hello\n");
        write(&root, "src/app.ts", "export const a = 1;\n");
        run(&root, &["add", "."]).await;
        run(&root, &["commit", "-q", "-m", "first"]).await;
        (dir, root)
    }

    fn files(value: &Value) -> Vec<Value> {
        value["files"].as_array().cloned().unwrap_or_default()
    }

    #[tokio::test]
    async fn status_reports_clean_tree() {
        let (dir, root) = repo().await;
        let out = Git::new(SpawnRunner).status(&diag(dir.path()), &root).await;
        assert_eq!(out["success"], true);
        assert_eq!(out["isRepo"], true);
        assert!(files(&out).is_empty());
    }

    #[tokio::test]
    async fn status_sees_edit_new_and_staged() {
        let (dir, root) = repo().await;
        write(&root, "readme.md", "changed\n");
        write(&root, "fresh.txt", "new\n");
        write(&root, "src/app.ts", "export const a = 2;\n");
        run(&root, &["add", "src/app.ts"]).await;
        let out = Git::new(SpawnRunner).status(&diag(dir.path()), &root).await;
        assert_eq!(out["success"], true);
        assert_eq!(files(&out).len(), 3);
    }

    #[tokio::test]
    async fn diff_one_file_and_subfolder_scope() {
        let (dir, root) = repo().await;
        let d = diag(dir.path());
        write(&root, "readme.md", "changed\n");
        write(&root, "src/app.ts", "export const a = 3;\n");
        let opts = DiffOptions {
            relative: "readme.md",
            staged: false,
            untracked: false,
            ignore_whitespace: false,
        };
        let out = Git::new(SpawnRunner)
            .diff(&d, &root, &opts, &|_| true)
            .await;
        let text = out["diff"].as_str().unwrap();
        assert!(text.contains("+changed"));
        assert!(!text.contains("app.ts"));
        let scoped = DiffOptions {
            relative: "src",
            ..opts
        };
        let out = Git::new(SpawnRunner)
            .diff(&d, &root, &scoped, &|_| true)
            .await;
        assert!(out["diff"].as_str().unwrap().contains("app.ts"));
    }

    #[tokio::test]
    async fn diff_skips_files_the_guard_refuses() {
        let (dir, root) = repo().await;
        write(&root, "src/app.ts", "export const a = 4;\n");
        let opts = DiffOptions {
            relative: ".",
            staged: false,
            untracked: false,
            ignore_whitespace: false,
        };
        let out = Git::new(SpawnRunner)
            .diff(&diag(dir.path()), &root, &opts, &|p| !p.ends_with("app.ts"))
            .await;
        assert!(!out["diff"].as_str().unwrap().contains("app.ts"));
        assert_eq!(out["skipped"], 1);
    }

    #[tokio::test]
    async fn untracked_file_appears_in_diff_when_asked() {
        let (dir, root) = repo().await;
        write(&root, "fresh.txt", "brand new\n");
        let opts = DiffOptions {
            relative: ".",
            staged: false,
            untracked: true,
            ignore_whitespace: false,
        };
        let out = Git::new(SpawnRunner)
            .diff(&diag(dir.path()), &root, &opts, &|_| true)
            .await;
        assert!(out["diff"].as_str().unwrap().contains("+brand new"));
    }

    #[tokio::test]
    async fn log_and_show_list_the_commit() {
        let (dir, root) = repo().await;
        let d = diag(dir.path());
        let git = Git::new(SpawnRunner);
        let log = git.log(&d, &root, None, false).await;
        assert_eq!(log["success"], true);
        assert_eq!(log["commits"].as_array().unwrap().len(), 1);
        let hash = log["commits"][0]["hash"].as_str().unwrap().to_owned();
        let show = git.show(&d, &root, &hash, false, &|_| true).await;
        assert_eq!(show["success"], true);
        assert!(show["diff"].as_str().unwrap().contains("hello"));
    }

    #[tokio::test]
    async fn branches_and_checkout() {
        let (dir, root) = repo().await;
        let d = diag(dir.path());
        let git = Git::new(SpawnRunner);
        run(&root, &["branch", "side"]).await;
        assert_eq!(git.branches(&d, &root).await["success"], true);
        assert_eq!(git.checkout(&d, &root, "side").await["success"], true);
        assert_eq!(git.checkout(&d, &root, "--detach").await["success"], false);
    }

    #[tokio::test]
    async fn stage_unstage_and_commit() {
        let (dir, root) = repo().await;
        let d = diag(dir.path());
        let git = Git::new(SpawnRunner);
        write(&root, "readme.md", "changed\n");
        assert_eq!(
            git.stage(&d, &root, &["readme.md".into()]).await["success"],
            true
        );
        let unstaged = git.unstage(&d, &root, &["readme.md".into()]).await;
        assert_eq!(unstaged["success"], true, "{unstaged}");
        assert_eq!(
            git.stage(&d, &root, &["readme.md".into()]).await["success"],
            true
        );
        assert_eq!(
            git.commit(&d, &root, "update readme").await["success"],
            true
        );
        assert!(files(&git.status(&d, &root).await).is_empty());
    }

    #[tokio::test]
    async fn empty_commit_message_is_refused() {
        let (dir, root) = repo().await;
        let out = Git::new(SpawnRunner)
            .commit(&diag(dir.path()), &root, "   ")
            .await;
        assert_eq!(out["success"], false);
    }

    #[tokio::test]
    async fn leading_dash_path_is_kept_as_a_path() {
        let (dir, root) = repo().await;
        write(&root, "-flag.txt", "x\n");
        let out = Git::new(SpawnRunner)
            .stage(&diag(dir.path()), &root, &["-flag.txt".into()])
            .await;
        assert_eq!(out["success"], true);
    }

    #[test]
    fn log_count_defaults_and_caps() {
        assert_eq!(log_count(None), 50);
        assert_eq!(log_count(Some(0.0)), 50);
        assert_eq!(log_count(Some(7.9)), 7);
        assert_eq!(log_count(Some(100_000.0)), MAX_LOG_ENTRIES);
    }

    #[test]
    fn clip_diff_keeps_whole_lines_under_budget() {
        let text = "a\n".repeat(MAX_DIFF_CHARS);
        let clipped = clip_diff(&text);
        assert!(clipped.encode_utf16().count() <= MAX_DIFF_CHARS);
        assert!(clipped.ends_with('\n'));
    }
}
