use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitRefKind {
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRef {
    pub name: String,
    pub kind: GitRefKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommitInfo {
    /// The full id, which the git commands take.
    pub id: String,
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitRef>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

fn run<P: AsRef<Path>>(dir: P, args: &[&str]) -> (bool, String) {
    match Command::new("git").args(args).current_dir(dir).output() {
        Ok(o) => {
            let mut text = String::from_utf8_lossy(&o.stdout).to_string();
            text.push_str(&String::from_utf8_lossy(&o.stderr));
            (o.status.success(), text)
        }
        Err(_) => (false, String::new()),
    }
}

pub fn git_diff<P: AsRef<Path>>(dir: P, ignore_whitespace: bool) -> String {
    let args: &[&str] = if ignore_whitespace {
        &["diff", "-w"]
    } else {
        &["diff"]
    };
    run(dir, args).1
}

/// The changes one commit made, against its first parent. Empty when the text is not a commit id.
pub fn git_show<P: AsRef<Path>>(dir: P, id: &str, ignore_whitespace: bool) -> String {
    if !(4..=64).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return String::new();
    }
    let mut args = vec![
        "show",
        "--format=",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--diff-merges=first-parent",
    ];
    if ignore_whitespace {
        args.push("-w");
    }
    args.extend([id, "--"]);
    run(dir, &args).1
}

/// The latest commits on every branch, newest first.
pub fn git_log<P: AsRef<Path>>(dir: P, max: usize) -> Vec<GitCommitInfo> {
    let count = max.to_string();
    let format = "--format=%H%x1f%an%x1f%ad%x1f%s%x1f%P%x1f%D%x1e";
    let args = [
        "log",
        "-n",
        &count,
        "--all",
        "--topo-order",
        "--no-show-signature",
        "--decorate=short",
        "--date=short",
        format,
    ];
    parse_log(&run(dir, &args).1)
}

fn parse_log(text: &str) -> Vec<GitCommitInfo> {
    text.split('\u{1e}')
        .filter_map(|record| {
            let parts: Vec<&str> = record.trim().split('\u{1f}').collect();
            if parts.len() < 5 {
                return None;
            }
            Some(GitCommitInfo {
                id: parts[0].to_owned(),
                hash: parts[0].chars().take(7).collect(),
                author: parts[1].to_owned(),
                date: parts[2].to_owned(),
                message: parts[3].to_owned(),
                parents: parts[4].split_whitespace().map(str::to_owned).collect(),
                refs: parts.get(5).map(|d| ref_list(d)).unwrap_or_default(),
            })
        })
        .collect()
}

/// The names in a `%D` decoration: "HEAD -> main, origin/main, tag: v1" gives each ref with its kind.
fn ref_list(text: &str) -> Vec<GitRef> {
    text.split(", ")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            if let Some(name) = part.strip_prefix("HEAD -> ") {
                GitRef {
                    name: name.to_owned(),
                    kind: GitRefKind::Head,
                }
            } else if part == "HEAD" {
                GitRef {
                    name: part.to_owned(),
                    kind: GitRefKind::Head,
                }
            } else if let Some(name) = part.strip_prefix("tag: ") {
                GitRef {
                    name: name.to_owned(),
                    kind: GitRefKind::Tag,
                }
            } else {
                let kind = if part.contains('/') {
                    GitRefKind::Remote
                } else {
                    GitRefKind::Branch
                };
                GitRef {
                    name: part.to_owned(),
                    kind,
                }
            }
        })
        .collect()
}

/// The branch HEAD is on, or "HEAD" when it is detached.
pub fn current_branch<P: AsRef<Path>>(dir: P) -> String {
    let (ok, text) = run(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let name = text.trim();
    if !ok || name.is_empty() {
        "HEAD".to_owned()
    } else {
        name.to_owned()
    }
}

pub fn git_branches<P: AsRef<Path>>(dir: P) -> Vec<GitBranch> {
    let (_, text) = run(
        dir,
        &[
            "for-each-ref",
            "--format=%(HEAD)%1f%(refname:short)",
            "refs/heads",
        ],
    );
    text.lines()
        .filter_map(|line| {
            let (head, name) = line.split_once('\u{1f}')?;
            (!name.is_empty()).then(|| GitBranch {
                name: name.to_owned(),
                current: head == "*",
            })
        })
        .collect()
}

/// Switches branch. Returns git's message when it refuses, `None` when it worked.
pub fn switch_branch<P: AsRef<Path>>(dir: P, name: &str) -> Option<String> {
    if name.starts_with('-') {
        return Some(name.to_owned());
    }
    let (ok, text) = run(dir, &["switch", name]);
    (!ok).then(|| text.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decorations_give_each_ref_its_kind() {
        let refs = ref_list("HEAD -> main, origin/main, tag: v1, dev");
        let kinds: Vec<_> = refs.iter().map(|r| (r.name.as_str(), r.kind)).collect();
        assert_eq!(
            kinds,
            [
                ("main", GitRefKind::Head),
                ("origin/main", GitRefKind::Remote),
                ("v1", GitRefKind::Tag),
                ("dev", GitRefKind::Branch),
            ]
        );
    }

    #[test]
    fn a_log_record_gives_parents_and_refs() {
        let text =
            "abc1234567\u{1f}Ann\u{1f}2026-01-02\u{1f}Fix it\u{1f}p1 p2\u{1f}HEAD -> main\u{1e}";
        let commits = parse_log(text);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "abc1234");
        assert_eq!(commits[0].parents, ["p1", "p2"]);
        assert_eq!(commits[0].refs[0].name, "main");
    }
}
