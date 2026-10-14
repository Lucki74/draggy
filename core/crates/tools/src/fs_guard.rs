//! The path policy behind every file tool: a path is resolved, symlinks followed, and checked against the folders the
//! conversation was given. Ports electron/fsGuard.cjs; refusal messages are the ones the model reads back.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

use crate::js;

/// How much of a file is worth handing to a model in one go.
pub const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
/// The leading bytes searched for a NUL, the way editors guess whether a file is text.
const TEXT_PROBE_BYTES: usize = 8_000;

/// Folders that are never opened, even inside a granted root. Matched case-insensitively.
const DENIED_SEGMENTS: [&str; 9] = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".gpg",
    ".docker",
    ".kube",
    ".password-store",
    "keychains",
    "credentials.d",
];

/// Refused by the shape of the name. The JS patterns are /i without /u, which fold ASCII letters only.
fn is_denied_file(lower: &str) -> bool {
    let env = lower == ".env" || lower.starts_with(".env.");
    let key = lower.strip_prefix("id_").is_some_and(|rest| {
        ["rsa", "dsa", "ecdsa", "ed25519"]
            .iter()
            .any(|kind| rest.starts_with(kind))
    });
    let secret_extension = [".pem", ".pfx", ".p12", ".keystore"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    let exact = [
        ".netrc",
        ".npmrc",
        ".pypirc",
        "credentials",
        ".git-credentials",
    ]
    .contains(&lower);
    env || key || secret_extension || exact
}

/// A name that is never opened. Folder walks use it too, so a search cannot read what a named path would refuse.
/// The name is tested as given and as NFKC-folded, so a Kelvin sign is a k, as in fsGuard.cjs.
pub fn is_denied_name(name: &str) -> bool {
    let folded: String = name.nfkc().collect();
    is_denied_form(name) || is_denied_form(&folded)
}

/// One spelling of a name. Folder names fold with the full Unicode lowercase; file names fold ASCII only.
fn is_denied_form(name: &str) -> bool {
    let segment = name.to_lowercase();
    DENIED_SEGMENTS.contains(&segment.as_str()) || is_denied_file(&name.to_ascii_lowercase())
}

/// Whether any part of a path, split on either separator, is a denied name.
fn has_denied_part(target: &str) -> bool {
    target
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .any(is_denied_name)
}

/// A refusal the model reads back. Each one is logged at WARN with the rule that matched.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct Refusal(pub String);

fn refuse(rule: &'static str, message: &str) -> Refusal {
    tracing::warn!(target: "files.guard", rule, "denied");
    Refusal(message.to_owned())
}

/// A refusal that names the path it was about, as the reference's WARN line does.
fn refuse_at(rule: &'static str, message: &str, path: &Path) -> Refusal {
    tracing::warn!(target: "files.guard", rule, path = %path.display(), "denied");
    Refusal(message.to_owned())
}

/// Failure to read a file: a refusal the model can read, or an I/O error the caller must handle.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error(transparent)]
    Refused(#[from] Refusal),
    #[error("could not read the file: {0}")]
    Io(#[from] io::Error),
}

/// Whether a request must name something that exists, and whether missing folders on the way may be made.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResolveOptions {
    pub must_exist: bool,
    pub create_parents: bool,
}

/// Text a model can work with: its contents and the size on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFile {
    pub text: String,
    pub bytes: u64,
}

/// Lexical resolution, like Node's path.resolve: `.` and `..` collapse, nothing touches the disk.
pub fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `lexical` against the current folder when the path is relative.
fn resolve_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return lexical(path);
    }
    match std::env::current_dir() {
        Ok(cwd) => lexical(&cwd.join(path)),
        Err(_) => lexical(path),
    }
}

/// The steps from `from` to `to`, joined with "/", the way Node's path.relative gives them for absolute paths.
pub(crate) fn relative_text(from: &Path, to: &Path) -> String {
    let from = lexical(from);
    let to = lexical(to);
    let from_parts: Vec<Component> = from.components().collect();
    let to_parts: Vec<Component> = to.components().collect();
    let common = from_parts
        .iter()
        .zip(&to_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let mut steps: Vec<String> = vec!["..".to_owned(); from_parts.len() - common];
    steps.extend(
        to_parts[common..]
            .iter()
            .map(|part| part.as_os_str().to_string_lossy().into_owned()),
    );
    steps.join("/")
}

/// Is `target` the folder itself or something under it? Both are compared after resolution.
pub fn is_inside(folder: &Path, target: &Path) -> bool {
    let relative = relative_text(folder, target);
    // TS quirk: a child whose name starts with two dots is refused as outside, as the JS check does.
    relative.is_empty() || !relative.starts_with("..")
}

/// The rule every request passes through. Protected paths are Draggy's own storage; they are compared as written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Guard {
    protected: Vec<PathBuf>,
}

impl Guard {
    pub fn new(protected: impl IntoIterator<Item = PathBuf>) -> Self {
        Self {
            protected: protected
                .into_iter()
                .filter(|path| !path.as_os_str().is_empty())
                .map(|path| resolve_path(&path))
                .collect(),
        }
    }

    /// Turns a requested path into one a tool may touch, or the reason it may not. Relative paths resolve against the
    /// first root, the project.
    pub fn resolve_within(
        &self,
        roots: &[PathBuf],
        requested: &str,
        options: ResolveOptions,
    ) -> Result<PathBuf, Refusal> {
        let asked = js::trim(requested);
        if asked.is_empty() {
            return Err(refuse("empty", "No file was named."));
        }

        let folders: Vec<&Path> = roots
            .iter()
            .filter(|root| !root.as_os_str().is_empty())
            .map(PathBuf::as_path)
            .collect();
        let Some(first) = folders.first() else {
            return Err(refuse(
                "no_folder",
                "This conversation has no folder to work in. Open a project first.",
            ));
        };

        // A path with a NUL means one thing to this check and another to the system call beneath it.
        if asked.contains('\0') {
            return Err(refuse("null_byte", "That file name is not usable."));
        }

        let joined = if Path::new(asked).is_absolute() {
            PathBuf::from(asked)
        } else {
            first.join(asked)
        };
        let absolute = resolve_path(&joined);

        let exists = absolute.exists();
        if options.must_exist && !exists {
            let name = absolute
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            return Err(refuse("missing", &format!("There is no {name}.")));
        }

        // exists() is false for a dangling link, so only the link itself shows it; a write would follow it out of the folder.
        if !exists
            && fs::symlink_metadata(&absolute).is_ok_and(|meta| meta.file_type().is_symlink())
        {
            return Err(refuse(
                "dangling_link",
                "That is a link to a file that is not there, so Draggy will not create it.",
            ));
        }

        // A new file inherits its folder, so the folder is what must be real. Parents may be made by the write.
        let anchor = if exists {
            Some(absolute.clone())
        } else if absolute.parent().is_some_and(Path::exists) {
            absolute.parent().map(Path::to_path_buf)
        } else if options.create_parents {
            nearest_existing(&absolute)
        } else {
            None
        };
        let real_anchor = anchor
            .as_deref()
            .and_then(|path| fs::canonicalize(path).ok());
        let (Some(anchor), Some(real_anchor)) = (anchor, real_anchor) else {
            return Err(refuse("no_anchor", "That folder does not exist."));
        };

        // Whatever of the path was still missing is rebuilt onto the real ancestor, so a symlink along the way is followed.
        let resolved = if exists {
            real_anchor
        } else {
            match absolute.strip_prefix(&anchor) {
                Ok(rest) if !rest.as_os_str().is_empty() => real_anchor.join(rest),
                _ => real_anchor,
            }
        };

        let inside = folders
            .iter()
            .any(|folder| fs::canonicalize(folder).is_ok_and(|real| is_inside(&real, &resolved)));
        if !inside {
            tracing::warn!(target: "files.guard", rule = "outside", path = %resolved.display(), roots = folders.len(), "denied");
            return Err(Refusal(
                "That path is outside the folder this conversation can reach.".to_owned(),
            ));
        }

        if self.protected.iter().any(|one| is_inside(one, &resolved)) {
            return Err(refuse_at(
                "protected",
                "That is Draggy's own storage, which is not yours to edit.",
                &resolved,
            ));
        }

        let shown = resolved.to_string_lossy();
        if has_denied_part(&shown) {
            return Err(refuse_at(
                "credentials",
                "That file holds credentials, so Draggy does not open it. Tell the user what you need and let them do it.",
                &resolved,
            ));
        }

        tracing::debug!(target: "files.guard", path = %resolved.display(), "allowed");
        Ok(resolved)
    }

    /// Whether a path found by walking a folder may be opened: not Draggy's storage, and no denied part.
    pub fn is_readable(&self, target: &Path) -> bool {
        let resolved = resolve_path(target);
        if self.protected.iter().any(|one| is_inside(one, &resolved)) {
            return false;
        }
        !has_denied_part(&resolved.to_string_lossy())
    }
}

/// The deepest folder above `target` that exists, or None when none does.
fn nearest_existing(target: &Path) -> Option<PathBuf> {
    let mut current = target;
    loop {
        let parent = current.parent()?;
        if parent.exists() {
            return Some(parent.to_path_buf());
        }
        current = parent;
    }
}

/// Text a model can work with, or the reason it cannot. A file over `limit` is refused, not cut.
pub fn read_text(file: &Path, limit: u64) -> Result<TextFile, ReadError> {
    // TS quirk: a missing file throws from statSync in the reference. Here it is the Io arm, the same failure by value.
    let meta = fs::metadata(file)?;
    if meta.is_dir() {
        return Err(refuse("folder", "That is a folder, not a file.").into());
    }
    if meta.len() > limit {
        let kb = |bytes: u64| ((bytes as f64) / 1024.0).round() as u64;
        return Err(refuse(
            "size",
            &format!(
                "That file is {} KB, over the {} KB a single read allows. Ask for part of it instead.",
                kb(meta.len()),
                kb(limit)
            ),
        )
        .into());
    }

    let bytes = fs::read(file)?;
    let probe = &bytes[..bytes.len().min(TEXT_PROBE_BYTES)];
    if probe.contains(&0) {
        return Err(refuse("not_text", "That file is not text.").into());
    }

    Ok(TextFile {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        bytes: meta.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_folders_and_files_are_denied_by_name() {
        assert!(is_denied_name(".SSH"));
        assert!(is_denied_name(".env.production"));
        assert!(is_denied_name("id_ed25519"));
        assert!(is_denied_name("server.PEM"));
        assert!(is_denied_name("credentials"));
        assert!(!is_denied_name(".envrc"));
        assert!(!is_denied_name("App.tsx"));
    }

    #[test]
    fn a_kelvin_sign_is_denied_as_the_k_it_folds_to() {
        assert!(is_denied_name(".\u{212A}eystore"));
        assert!(is_denied_name(".KEYSTORE"));
        assert!(is_denied_name(".\u{212A}UBE"));
        assert!(!is_denied_name(".\u{212A}eyboard"));
    }

    #[test]
    fn a_path_is_denied_when_any_part_of_it_is() {
        assert!(has_denied_part("/work/project/.ssh/config"));
        assert!(has_denied_part("/work/project\\.env"));
        assert!(!has_denied_part("/work/project/src/main.rs"));
    }

    #[test]
    fn lexical_resolution_stops_at_the_root() {
        assert_eq!(lexical(Path::new("/a/b/../../../c")), PathBuf::from("/c"));
        assert_eq!(lexical(Path::new("/a/./b//c/")), PathBuf::from("/a/b/c"));
    }

    #[test]
    fn a_child_named_with_two_dots_is_outside_the_folder() {
        // TS quirk: fsGuard.cjs tests the relative path for a leading "..", so "..notes" is refused too.
        assert!(!is_inside(
            Path::new("/work/project"),
            Path::new("/work/project/..notes")
        ));
        assert!(is_inside(
            Path::new("/work/project"),
            Path::new("/work/project/src")
        ));
    }
}
