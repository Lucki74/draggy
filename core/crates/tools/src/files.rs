//! The file tools past the guard: list, read, write, edit, move, delete, search and undo, with every change kept as a
//! checkpoint. Ports electron/fileOps.cjs and the checkpoint bookkeeping of electron/checkpoints.cjs. Persistence goes
//! through `CheckpointStore`, which the storage crate implements, so this crate does not depend on it.

use std::cmp::Ordering;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use icu_collator::options::CollatorOptions;
use icu_collator::{CollatorBorrowed, CollatorPreferences};
use sha2::{Digest, Sha256};

use crate::fs_guard::{self, Guard, MAX_READ_BYTES, ReadError, Refusal, ResolveOptions};
use crate::js;

pub const MAX_LIST_ENTRIES: usize = 500;
pub const MAX_SEARCH_FILES: usize = 4_000;
pub const MAX_SEARCH_HITS: i64 = 50;
const MAX_SEARCHED_BYTES: u64 = 512 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// A search hit shows its line up to this many UTF-16 units, as the reference slices it.
const MAX_LINE_UNITS: usize = 300;

/// Generated, vendored or someone else's. A search walks past all of these.
pub const SKIPPED_DIRS: [&str; 17] = [
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "dist-electron",
    "build",
    "out",
    ".next",
    ".nuxt",
    "target",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    "coverage",
];

/// Audio and video the file pane plays, by extension.
const MEDIA_MIME: [(&str, &str); 9] = [
    (".mp4", "video/mp4"),
    (".webm", "video/webm"),
    (".mov", "video/quicktime"),
    (".mp3", "audio/mpeg"),
    (".wav", "audio/wav"),
    (".ogg", "audio/ogg"),
    (".m4a", "audio/mp4"),
    (".flac", "audio/flac"),
    (".aac", "audio/aac"),
];

const IMAGE_MIME: [(&str, &str); 14] = [
    (".png", "image/png"),
    (".jpg", "image/jpeg"),
    (".jpeg", "image/jpeg"),
    (".jfif", "image/jpeg"),
    (".gif", "image/gif"),
    (".webp", "image/webp"),
    (".svg", "image/svg+xml"),
    (".ico", "image/x-icon"),
    (".cur", "image/x-icon"),
    (".bmp", "image/bmp"),
    (".avif", "image/avif"),
    (".apng", "image/apng"),
    (".tiff", "image/tiff"),
    (".tif", "image/tiff"),
];

const MUST_EXIST: ResolveOptions = ResolveOptions {
    must_exist: true,
    create_parents: false,
};
const MAY_CREATE: ResolveOptions = ResolveOptions {
    must_exist: false,
    create_parents: true,
};

/// Why a file operation did not happen. A refusal is for the model to read; the rest are failures of the disk or store.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error(transparent)]
    Refused(#[from] Refusal),
    #[error("could not change the file: {0}")]
    Io(#[from] io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl From<ReadError> for FileError {
    fn from(error: ReadError) -> Self {
        match error {
            ReadError::Refused(refusal) => Self::Refused(refusal),
            ReadError::Io(error) => Self::Io(error),
        }
    }
}

fn refused(message: impl Into<String>) -> FileError {
    FileError::Refused(Refusal(message.into()))
}

/// The store could not keep or find a checkpoint. The storage crate maps its own errors into this.
#[derive(Debug, thiserror::Error)]
#[error("checkpoint store failed: {0}")]
pub struct StoreError(pub String);

/// The kind of change a checkpoint records. Storage keeps the lowercase name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Write,
    Move,
    Delete,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Write => "write",
            Self::Move => "move",
            Self::Delete => "delete",
        }
    }
}

/// What a change records before the store adds its id and time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCheckpoint {
    pub workspace_id: String,
    pub chat_id: Option<String>,
    pub path: PathBuf,
    pub action: Action,
    /// For a move, the path it came from.
    pub detail: Option<String>,
    /// The hash of the content before the change; None when the file was not there.
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
}

/// A recorded change, as the store returns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checkpoint {
    pub id: i64,
    pub entry: NewCheckpoint,
}

/// Where checkpoints live: a row for each change, and the bytes its hashes name. Storage implements it.
pub trait CheckpointStore {
    /// Keeps `bytes` under `content_hash(bytes)` and returns that hash. The same bytes are kept once.
    fn keep(&self, bytes: &[u8]) -> Result<String, StoreError>;
    /// The bytes behind a hash, or None when the store no longer has them.
    fn read(&self, hash: &str) -> Option<Vec<u8>>;
    /// Records a change and returns its id.
    fn add(&self, entry: &NewCheckpoint) -> Result<i64, StoreError>;
    fn get(&self, id: i64) -> Result<Option<Checkpoint>, StoreError>;
    fn drop_checkpoint(&self, id: i64) -> Result<(), StoreError>;
}

/// Moves a file into the recycle bin, so a deletion can be taken back. The platform supplies it.
pub trait Recycler {
    fn recycle(&self, path: &Path) -> io::Result<()>;
}

/// The SHA-256 of some bytes, in lowercase hex. Checkpoint hashes are this value.
pub fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The hash of a file's bytes before a change. None for anything that is not a regular file, or cannot be read.
pub fn snapshot<S: CheckpointStore>(store: &S, file: &Path) -> Option<String> {
    let meta = fs::metadata(file).ok()?;
    if !meta.is_file() {
        return None;
    }
    let bytes = fs::read(file).ok()?;
    store.keep(&bytes).ok()
}

/// The payload of a `data:<type>;base64,<payload>` string, or None when the text is not one. Mirrors the JS pattern.
fn data_url_payload(raw: &str) -> Option<&str> {
    let rest = raw.strip_prefix("data:")?;
    let semi = rest.find(';')?;
    if semi == 0 {
        return None;
    }
    let payload = rest[semi..].strip_prefix(";base64,")?;
    let line_break = payload.contains(['\n', '\r', '\u{2028}', '\u{2029}']);
    (!payload.is_empty() && !line_break).then_some(payload)
}

/// Decodes base64 as Node's `Buffer.from(text, "base64")` does: both alphabets, other characters skipped, stop at "=".
// TS quirk: only the low byte of each UTF-16 unit is read, so a non-Latin character can decode as a base64 digit.
fn node_base64(payload: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() / 4 * 3 + 2);
    let mut group = [0u8; 4];
    let mut filled = 0;
    for unit in payload.encode_utf16() {
        let value = match (unit & 0xff) as u8 {
            byte @ b'A'..=b'Z' => byte - b'A',
            byte @ b'a'..=b'z' => byte - b'a' + 26,
            byte @ b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        group[filled] = value;
        filled += 1;
        if filled == 4 {
            out.push((group[0] << 2) | (group[1] >> 4));
            out.push((group[1] << 4) | (group[2] >> 2));
            out.push((group[2] << 6) | group[3]);
            filled = 0;
        }
    }
    if filled >= 2 {
        out.push((group[0] << 2) | (group[1] >> 4));
    }
    if filled >= 3 {
        out.push((group[1] << 4) | (group[2] >> 2));
    }
    out
}

/// The result of applying one edit to text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub next: String,
    pub replaced: usize,
}

/// Replaces the exact text `find` with `replace`. `expected` is how many occurrences the caller accepts; zero means one.
pub fn apply_edit(
    text: &str,
    find: &str,
    replace: &str,
    expected: i64,
) -> Result<Applied, FileError> {
    if find.is_empty() {
        return Err(refused("Nothing was given to replace."));
    }
    let occurrences = text.matches(find).count();
    if occurrences == 0 {
        return Err(refused(
            "That text is not in the file. Read it again and copy the lines exactly, whitespace included.",
        ));
    }
    let wanted = if expected == 0 { 1 } else { expected };
    if occurrences as i64 != wanted {
        return Err(refused(format!(
            "That text appears {occurrences} times, not {wanted}. Include more of the surrounding lines so it matches once, or say how many to replace."
        )));
    }
    Ok(Applied {
        next: text.replace(find, replace),
        replaced: occurrences,
    })
}

/// One entry of a folder listing.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_directory: bool,
    pub size: u64,
    pub modified_ms: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Listing {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

/// What kind of content `read` handed back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    Text,
    Image,
    Media,
}

/// A file read for the model. Images and media come back as data URLs; SVG also as its source text.
#[derive(Debug, Clone, PartialEq)]
pub struct Opened {
    pub path: PathBuf,
    pub kind: ContentKind,
    pub mime: Option<&'static str>,
    pub data_url: Option<String>,
    pub text: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Written {
    pub path: PathBuf,
    pub checkpoint_id: i64,
    pub created: bool,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edited {
    pub path: PathBuf,
    pub checkpoint_id: i64,
    pub replaced: usize,
    pub before: String,
    pub after: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moved {
    pub path: PathBuf,
    pub from: PathBuf,
    pub checkpoint_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removed {
    pub path: PathBuf,
    pub checkpoint_id: i64,
}

/// What a search asks for. An empty name or text is not a filter; both empty is refused.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Query {
    pub name: String,
    pub text: String,
    /// The reference takes Number(limit), so a fraction stops after the first whole count above it.
    pub limit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub path: PathBuf,
    pub name: String,
    /// One-based line of a text match; None for a name match.
    pub line: Option<usize>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Search {
    pub hits: Vec<Hit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reverted {
    pub path: PathBuf,
    /// For an undone move, where the file was before the undo.
    pub from: Option<PathBuf>,
    pub workspace_id: String,
}

/// What a finished operation reports to the log: the file it names and how much it moved or found.
#[derive(Default)]
struct Shown {
    workspace: Option<String>,
    path: Option<PathBuf>,
    bytes: Option<u64>,
    hits: Option<usize>,
}

/// The last part of a path, as Node's path.basename gives it; the whole text when there is none.
fn basename(text: &str) -> String {
    Path::new(text).file_name().map_or_else(
        || text.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// The file tools for one process. `roots` gives the folders a workspace may reach; the store and recycler are handed in.
pub struct FileOps<S, T, R> {
    guard: Guard,
    store: S,
    recycler: T,
    roots: R,
}

impl<S, T, R> FileOps<S, T, R>
where
    S: CheckpointStore,
    T: Recycler,
    R: Fn(&str) -> Vec<PathBuf>,
{
    pub fn new(guard: Guard, store: S, recycler: T, roots: R) -> Self {
        Self {
            guard,
            store,
            recycler,
            roots,
        }
    }

    fn resolve(
        &self,
        workspace: &str,
        requested: &str,
        options: ResolveOptions,
    ) -> Result<PathBuf, FileError> {
        let roots = (self.roots)(workspace);
        self.guard
            .resolve_within(&roots, requested, options)
            .map_err(FileError::from)
    }

    fn record(&self, entry: NewCheckpoint, bytes: u64) -> Result<i64, FileError> {
        let id = self.store.add(&entry)?;
        tracing::info!(target: "files", files = 1, bytes, "checkpoint created");
        Ok(id)
    }

    fn restored(&self, id: i64) -> Result<(), FileError> {
        self.store.drop_checkpoint(id)?;
        tracing::info!(target: "files", files = 1, "checkpoint restored");
        Ok(())
    }

    /// Lists a folder: folders first, then by name. An empty request means the folder itself.
    pub fn list(&self, workspace: &str, requested: &str) -> Result<Listing, FileError> {
        self.observe(
            "list",
            Some(workspace),
            Some(if requested.is_empty() { "." } else { requested }),
            || self.list_now(workspace, requested),
            |listing| Shown {
                path: Some(listing.path.clone()),
                ..Shown::default()
            },
        )
    }

    /// Reads a file: text under the read limit, or an image or media file as a data URL.
    pub fn read(&self, workspace: &str, requested: &str) -> Result<Opened, FileError> {
        self.observe(
            "read",
            Some(workspace),
            Some(requested),
            || self.read_now(workspace, requested),
            |opened| Shown {
                path: Some(opened.path.clone()),
                bytes: Some(opened.bytes),
                ..Shown::default()
            },
        )
    }

    /// Writes a whole file, making its folders. Contents that are a base64 data URL are written as the bytes they carry.
    pub fn write(
        &self,
        workspace: &str,
        requested: &str,
        contents: &str,
        chat: Option<&str>,
    ) -> Result<Written, FileError> {
        self.observe(
            "write",
            Some(workspace),
            Some(requested),
            || self.write_now(workspace, requested, contents, chat),
            |written| Shown {
                path: Some(written.path.clone()),
                bytes: Some(written.bytes),
                ..Shown::default()
            },
        )
    }

    /// Replaces exact text in a file. `expected` is the number of occurrences the caller accepts; zero means one.
    pub fn edit(
        &self,
        workspace: &str,
        requested: &str,
        find: &str,
        replace: &str,
        expected: i64,
        chat: Option<&str>,
    ) -> Result<Edited, FileError> {
        self.observe(
            "edit",
            Some(workspace),
            Some(requested),
            || self.edit_now(workspace, requested, find, replace, expected, chat),
            |edited| Shown {
                path: Some(edited.path.clone()),
                bytes: Some(edited.bytes),
                ..Shown::default()
            },
        )
    }

    /// Renames a file or folder within the workspace, refusing to overwrite what is already there.
    pub fn move_path(
        &self,
        workspace: &str,
        from: &str,
        to: &str,
        chat: Option<&str>,
    ) -> Result<Moved, FileError> {
        self.observe(
            "move",
            Some(workspace),
            Some(from),
            || self.move_path_now(workspace, from, to, chat),
            |moved| Shown {
                path: Some(moved.path.clone()),
                ..Shown::default()
            },
        )
    }

    /// Sends a file to the recycle bin and records a checkpoint, so the delete can be undone. Folders are refused.
    pub fn remove(
        &self,
        workspace: &str,
        requested: &str,
        chat: Option<&str>,
    ) -> Result<Removed, FileError> {
        self.observe(
            "remove",
            Some(workspace),
            Some(requested),
            || self.remove_now(workspace, requested, chat),
            |removed| Shown {
                path: Some(removed.path.clone()),
                ..Shown::default()
            },
        )
    }

    /// Finds files by name, by text inside them, or both. Generated, vendored and credential folders are not walked.
    pub fn search(&self, workspace: &str, query: &Query) -> Result<Search, FileError> {
        self.observe(
            "search",
            Some(workspace),
            None,
            || self.search_now(workspace, query),
            |found| Shown {
                hits: Some(found.hits.len()),
                ..Shown::default()
            },
        )
    }

    /// Undoes one recorded change and forgets its row. The path goes back through the guard, since the folder may be gone.
    pub fn revert(&self, id: i64) -> Result<Reverted, FileError> {
        self.observe(
            "revert",
            None,
            None,
            || self.revert_now(id),
            |reverted| Shown {
                workspace: Some(reverted.workspace_id.clone()),
                path: Some(reverted.path.clone()),
                ..Shown::default()
            },
        )
    }

    /// The full path of an existing file or folder, for handing to the system shell.
    pub fn locate(&self, workspace: &str, requested: &str) -> Result<PathBuf, FileError> {
        self.observe(
            "locate",
            Some(workspace),
            Some(requested),
            || self.locate_now(workspace, requested),
            |path| Shown {
                path: Some(path.clone()),
                ..Shown::default()
            },
        )
    }

    /// One line per operation, as the reference's observer writes it: what, where, how much, and the outcome. A refusal
    /// is a WARN; an error that stops the operation is an ERROR, and is returned as it was.
    fn observe<V>(
        &self,
        op: &'static str,
        workspace: Option<&str>,
        requested: Option<&str>,
        run: impl FnOnce() -> Result<V, FileError>,
        shown: impl FnOnce(&V) -> Shown,
    ) -> Result<V, FileError> {
        match run() {
            Ok(value) => {
                let shown = shown(&value);
                let folder = workspace
                    .map(str::to_owned)
                    .or(shown.workspace)
                    .unwrap_or_default();
                let path = match &shown.path {
                    Some(path) => Some(self.shown_path(&folder, path)),
                    None => requested.and_then(|asked| self.related(&folder, asked)),
                };
                tracing::info!(target: "files", op, path = path.as_deref(), bytes = shown.bytes, hits = shown.hits.map(|hits| hits as u64), outcome = "ok", "file op done");
                Ok(value)
            }
            Err(error) => {
                let folder = workspace.unwrap_or_default();
                let path = requested.and_then(|asked| self.related(folder, asked));
                if matches!(error, FileError::Refused(_)) {
                    tracing::warn!(target: "files", op, path = path.as_deref(), outcome = "refused", "file op refused");
                } else {
                    tracing::error!(target: "files", op, path = path.as_deref(), error = %error, "file op failed");
                }
                Err(error)
            }
        }
    }

    /// The workspace-relative path of a file, or its basename when no folder of the workspace holds it.
    fn shown_path(&self, workspace: &str, full: &Path) -> String {
        let folders = (self.roots)(workspace);
        match folders.iter().find(|folder| full.starts_with(folder)) {
            Some(folder) => {
                let relative = full.strip_prefix(folder).unwrap_or(full);
                if relative.as_os_str().is_empty() {
                    ".".to_owned()
                } else {
                    relative.to_string_lossy().into_owned()
                }
            }
            None => basename(full.as_os_str().to_string_lossy().as_ref()),
        }
    }

    /// The path a refused or failed call names: the file it asked for, resolved as the operation would, else its basename.
    fn related(&self, workspace: &str, requested: &str) -> Option<String> {
        if requested.is_empty() {
            return None;
        }
        match self.resolve(workspace, requested, MAY_CREATE) {
            Ok(resolved) => Some(self.shown_path(workspace, &resolved)),
            Err(_) => Some(basename(requested)),
        }
    }

    /// Lists a folder: folders first, then by name. An empty request means the folder itself.
    fn list_now(&self, workspace: &str, requested: &str) -> Result<Listing, FileError> {
        let requested = if requested.is_empty() { "." } else { requested };
        let resolved = self.resolve(workspace, requested, MUST_EXIST)?;
        if !fs::metadata(&resolved)?.is_dir() {
            return Err(refused("That is a file, not a folder."));
        }

        // Node lists a folder sorted by bytes, so ties in the locale order keep that order.
        let mut read: Vec<fs::DirEntry> = fs::read_dir(&resolved)?.collect::<Result<_, _>>()?;
        read.sort_by_key(fs::DirEntry::file_name);
        let mut entries = Vec::new();
        for entry in read {
            let path = entry.path();
            // A symlink is not a directory here, as Node's Dirent reports it; sizes follow the link as statSync does.
            let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir());
            let (size, modified_ms) = match fs::metadata(&path) {
                Ok(meta) => (meta.len(), modified_ms(&meta)),
                Err(_) => (0, 0.0),
            };
            entries.push(Entry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path,
                is_directory,
                size,
                modified_ms,
            });
        }
        entries.sort_by(compare_entries);

        let truncated = entries.len() > MAX_LIST_ENTRIES;
        entries.truncate(MAX_LIST_ENTRIES);
        Ok(Listing {
            path: resolved,
            entries,
            truncated,
        })
    }

    /// Reads a file: text under the read limit, or an image or media file as a data URL.
    fn read_now(&self, workspace: &str, requested: &str) -> Result<Opened, FileError> {
        let resolved = self.resolve(workspace, requested, MUST_EXIST)?;
        let ext = extension_of(&resolved);

        let Some(mime) = lookup(&IMAGE_MIME, &ext).or_else(|| lookup(&MEDIA_MIME, &ext)) else {
            let text = fs_guard::read_text(&resolved, MAX_READ_BYTES)?;
            return Ok(Opened {
                path: resolved,
                kind: ContentKind::Text,
                mime: None,
                data_url: None,
                text: text.text,
                bytes: text.bytes,
            });
        };

        let is_media = lookup(&MEDIA_MIME, &ext).is_some();
        let meta = fs::metadata(&resolved)?;
        if meta.is_dir() {
            return Err(refused("That is a folder, not a file."));
        }
        if meta.len() > MAX_IMAGE_BYTES {
            let mb = ((meta.len() as f64) / 1_048_576.0).round() as u64;
            let what = if is_media { "file" } else { "image" };
            return Err(refused(format!(
                "That {what} is {mb} MB, over the 20 MB limit."
            )));
        }

        let bytes = fs::read(&resolved)?;
        let text = if ext == ".svg" {
            String::from_utf8_lossy(&bytes).into_owned()
        } else {
            String::new()
        };
        Ok(Opened {
            path: resolved,
            kind: if is_media {
                ContentKind::Media
            } else {
                ContentKind::Image
            },
            mime: Some(mime),
            data_url: Some(format!("data:{mime};base64,{}", STANDARD.encode(&bytes))),
            text,
            bytes: meta.len(),
        })
    }

    /// Writes a whole file, making its folders. Contents that are a base64 data URL are written as the bytes they carry.
    fn write_now(
        &self,
        workspace: &str,
        requested: &str,
        contents: &str,
        chat: Option<&str>,
    ) -> Result<Written, FileError> {
        let resolved = self.resolve(workspace, requested, MAY_CREATE)?;
        let data = match data_url_payload(contents) {
            Some(payload) => node_base64(payload),
            None => contents.as_bytes().to_vec(),
        };

        let before = snapshot(&self.store, &resolved);
        make_parent(&resolved)?;
        fs::write(&resolved, &data)?;

        let bytes = data.len() as u64;
        let after_hash = self.store.keep(&data)?;
        let checkpoint_id = self.record(
            NewCheckpoint {
                workspace_id: workspace.to_owned(),
                chat_id: chat.map(str::to_owned),
                path: resolved.clone(),
                action: Action::Write,
                detail: None,
                before_hash: before.clone(),
                after_hash: Some(after_hash),
            },
            bytes,
        )?;
        Ok(Written {
            path: resolved,
            checkpoint_id,
            created: before.is_none(),
            bytes,
        })
    }

    /// Replaces exact text in a file. `expected` is the number of occurrences the caller accepts; zero means one.
    fn edit_now(
        &self,
        workspace: &str,
        requested: &str,
        find: &str,
        replace: &str,
        expected: i64,
        chat: Option<&str>,
    ) -> Result<Edited, FileError> {
        let resolved = self.resolve(workspace, requested, MUST_EXIST)?;
        let current = fs_guard::read_text(&resolved, MAX_READ_BYTES)?;
        let applied = apply_edit(&current.text, find, replace, expected)?;

        let before_hash = self.store.keep(current.text.as_bytes())?;
        fs::write(&resolved, applied.next.as_bytes())?;
        let after_hash = self.store.keep(applied.next.as_bytes())?;

        let bytes = applied.next.len() as u64;
        let checkpoint_id = self.record(
            NewCheckpoint {
                workspace_id: workspace.to_owned(),
                chat_id: chat.map(str::to_owned),
                path: resolved.clone(),
                action: Action::Write,
                detail: None,
                before_hash: Some(before_hash),
                after_hash: Some(after_hash),
            },
            bytes,
        )?;
        Ok(Edited {
            path: resolved,
            checkpoint_id,
            replaced: applied.replaced,
            before: current.text,
            after: applied.next,
            bytes,
        })
    }

    /// Moves or renames a file. The destination must not exist.
    fn move_path_now(
        &self,
        workspace: &str,
        from: &str,
        to: &str,
        chat: Option<&str>,
    ) -> Result<Moved, FileError> {
        let source = self.resolve(workspace, from, MUST_EXIST)?;
        let target = self.resolve(workspace, to, MAY_CREATE)?;
        if target.exists() {
            return Err(refused("Something is already there."));
        }

        make_parent(&target)?;
        fs::rename(&source, &target)?;

        let from_text = source.to_string_lossy().into_owned();
        let checkpoint_id = self.record(
            NewCheckpoint {
                workspace_id: workspace.to_owned(),
                chat_id: chat.map(str::to_owned),
                path: target.clone(),
                action: Action::Move,
                detail: Some(from_text),
                before_hash: None,
                after_hash: None,
            },
            0,
        )?;
        Ok(Moved {
            path: target,
            from: source,
            checkpoint_id,
        })
    }

    /// Sends a file to the recycle bin. Folders are refused: the model names the files instead.
    fn remove_now(
        &self,
        workspace: &str,
        requested: &str,
        chat: Option<&str>,
    ) -> Result<Removed, FileError> {
        let resolved = self.resolve(workspace, requested, MUST_EXIST)?;
        if fs::metadata(&resolved)?.is_dir() {
            return Err(refused(
                "Draggy does not delete folders. Name the files instead.",
            ));
        }

        let before = snapshot(&self.store, &resolved);
        self.recycler.recycle(&resolved)?;

        let checkpoint_id = self.record(
            NewCheckpoint {
                workspace_id: workspace.to_owned(),
                chat_id: chat.map(str::to_owned),
                path: resolved.clone(),
                action: Action::Delete,
                detail: None,
                before_hash: before,
                after_hash: None,
            },
            0,
        )?;
        Ok(Removed {
            path: resolved,
            checkpoint_id,
        })
    }

    /// Finds files by name, by text inside them, or both. Generated, vendored and credential folders are not walked.
    fn search_now(&self, workspace: &str, query: &Query) -> Result<Search, FileError> {
        let folders = (self.roots)(workspace);
        if folders.is_empty() {
            return Err(refused(
                "This conversation has no folder to search. Open a project first.",
            ));
        }
        let name_part = query.name.to_lowercase();
        if name_part.is_empty() && query.text.is_empty() {
            return Err(refused("Give a file name or some text to look for."));
        }

        // TS quirk: a zero, missing or NaN limit means the default of fifty, as `Number(limit) || 50` does.
        let limit = query
            .limit
            .filter(|asked| *asked != 0.0 && !asked.is_nan())
            .unwrap_or(MAX_SEARCH_HITS as f64)
            .min(MAX_SEARCH_HITS as f64);
        let mut walk = Walk {
            guard: &self.guard,
            name_part,
            text_part: &query.text,
            limit,
            hits: Vec::new(),
            visited: 0,
        };
        for folder in &folders {
            walk.walk(folder);
        }
        Ok(Search {
            hits: walk.hits,
            truncated: walk.visited >= MAX_SEARCH_FILES,
        })
    }

    /// Undoes one recorded change and forgets its row. The path goes back through the guard, since the folder may be gone.
    fn revert_now(&self, id: i64) -> Result<Reverted, FileError> {
        let Some(Checkpoint { entry, .. }) = self.store.get(id)? else {
            return Err(refused("There is no such change to undo."));
        };
        let workspace = entry.workspace_id.clone();
        let path_text = entry.path.to_string_lossy().into_owned();

        if entry.action == Action::Move {
            let current = self.resolve(&workspace, &path_text, MUST_EXIST)?;
            let back = self.resolve(
                &workspace,
                entry.detail.as_deref().unwrap_or(""),
                MAY_CREATE,
            )?;
            make_parent(&back)?;
            fs::rename(&current, &back)?;
            self.restored(id)?;
            return Ok(Reverted {
                path: back,
                from: Some(current),
                workspace_id: workspace,
            });
        }

        let resolved = self.resolve(&workspace, &path_text, MAY_CREATE)?;
        match entry.before_hash.as_deref().filter(|hash| !hash.is_empty()) {
            Some(hash) => {
                let previous = self
                    .store
                    .read(hash)
                    .ok_or_else(|| refused("The earlier version is no longer stored."))?;
                make_parent(&resolved)?;
                fs::write(&resolved, previous)?;
            }
            // Nothing was there before, so undoing means taking the new file away again.
            None if resolved.exists() => self.recycler.recycle(&resolved)?,
            None => {}
        }
        self.restored(id)?;
        Ok(Reverted {
            path: resolved,
            from: None,
            workspace_id: workspace,
        })
    }

    /// The full path of an existing file or folder, for handing to the system shell.
    fn locate_now(&self, workspace: &str, requested: &str) -> Result<PathBuf, FileError> {
        self.resolve(workspace, requested, MUST_EXIST)
    }
}

/// The state of one search walk.
struct Walk<'a> {
    guard: &'a Guard,
    name_part: String,
    text_part: &'a str,
    limit: f64,
    hits: Vec<Hit>,
    visited: usize,
}

impl Walk<'_> {
    fn done(&self) -> bool {
        self.hits.len() as f64 >= self.limit || self.visited >= MAX_SEARCH_FILES
    }

    fn walk(&mut self, dir: &Path) {
        if self.done() {
            return;
        }
        let Ok(read) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = read.flatten().collect();
        // Sorted by bytes, as Node's readdir sorts them, so a search gives the same hits every time.
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            if self.done() {
                return;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let full = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };

            if kind.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) && !fs_guard::is_denied_name(&name) {
                    self.walk(&full);
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }

            // The rule a named path gets: a search must not be a way to read what the guard would refuse.
            if !self.guard.is_readable(&full) {
                continue;
            }
            self.visited += 1;

            if !self.name_part.is_empty() && !name.to_lowercase().contains(&self.name_part) {
                continue;
            }
            if self.text_part.is_empty() {
                self.hits.push(Hit {
                    path: full,
                    name,
                    line: None,
                    text: None,
                });
                continue;
            }

            let Ok(contents) = fs_guard::read_text(&full, MAX_SEARCHED_BYTES) else {
                continue;
            };
            for (index, line) in contents.text.split('\n').enumerate() {
                if self.hits.len() as f64 >= self.limit {
                    break;
                }
                if !line.contains(self.text_part) {
                    continue;
                }
                self.hits.push(Hit {
                    path: full.clone(),
                    name: name.clone(),
                    line: Some(index + 1),
                    text: Some(js::take_units(js::trim(line), MAX_LINE_UNITS)),
                });
            }
        }
    }
}

/// Sorts folders before files, then by name the way `localeCompare(b)` does.
fn compare_entries(a: &Entry, b: &Entry) -> Ordering {
    match (a.is_directory, b.is_directory) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => locale_cmp(&a.name, &b.name),
    }
}

/// `localeCompare(b)` in English: ICU's root collation.
/// TS quirk: the reference sorts by the system locale, this port by ICU root. Non-English systems may order differently.
pub fn locale_cmp(a: &str, b: &str) -> Ordering {
    match collator() {
        Some(collator) => collator.compare(a, b),
        None => a.cmp(b),
    }
}

/// Built once. Compiled data always builds, so the code point fallback in `locale_cmp` only guards a broken build.
fn collator() -> Option<&'static CollatorBorrowed<'static>> {
    static COLLATOR: OnceLock<Option<CollatorBorrowed<'static>>> = OnceLock::new();
    COLLATOR
        .get_or_init(|| {
            match CollatorBorrowed::try_new(
                CollatorPreferences::default(),
                CollatorOptions::default(),
            ) {
                Ok(collator) => Some(collator),
                Err(error) => {
                    tracing::error!(target: "files", error = %error, "collator unavailable");
                    None
                }
            }
        })
        .as_ref()
}

/// The lowercase extension with its dot, as Node's extname gives it; empty when there is none.
fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn lookup(table: &[(&'static str, &'static str)], ext: &str) -> Option<&'static str> {
    table
        .iter()
        .find(|(known, _)| *known == ext)
        .map(|(_, mime)| *mime)
}

fn make_parent(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(parent) => fs::create_dir_all(parent),
        None => Ok(()),
    }
}

fn modified_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |since| since.as_secs_f64() * 1000.0)
}

/// A file's own name, for the timeline: the last piece of its path, or the whole text when there is none.
pub fn name_of(file_path: &str) -> String {
    file_path
        .split(['/', '\\'])
        .rfind(|part| !part.is_empty())
        .unwrap_or(file_path)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// Keeps checkpoint rows and blobs in memory, the way the storage crate keeps them on disk.
    #[derive(Default)]
    struct MemoryStore {
        blobs: RefCell<std::collections::BTreeMap<String, Vec<u8>>>,
        rows: RefCell<std::collections::BTreeMap<i64, NewCheckpoint>>,
        next: RefCell<i64>,
    }

    impl CheckpointStore for MemoryStore {
        fn keep(&self, bytes: &[u8]) -> Result<String, StoreError> {
            let hash = content_hash(bytes);
            self.blobs
                .borrow_mut()
                .entry(hash.clone())
                .or_insert_with(|| bytes.to_vec());
            Ok(hash)
        }

        fn read(&self, hash: &str) -> Option<Vec<u8>> {
            self.blobs.borrow().get(hash).cloned()
        }

        fn add(&self, entry: &NewCheckpoint) -> Result<i64, StoreError> {
            let mut next = self.next.borrow_mut();
            *next += 1;
            self.rows.borrow_mut().insert(*next, entry.clone());
            Ok(*next)
        }

        fn get(&self, id: i64) -> Result<Option<Checkpoint>, StoreError> {
            Ok(self.rows.borrow().get(&id).map(|entry| Checkpoint {
                id,
                entry: entry.clone(),
            }))
        }

        fn drop_checkpoint(&self, id: i64) -> Result<(), StoreError> {
            self.rows.borrow_mut().remove(&id);
            Ok(())
        }
    }

    /// Deletes for real, standing in for the recycle bin.
    struct Binned;

    impl Recycler for Binned {
        fn recycle(&self, path: &Path) -> io::Result<()> {
            fs::remove_file(path)
        }
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        root: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = fs::canonicalize(dir.path())
            .expect("real path")
            .join("project");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("notes.md"), "first line\nsecond line\n").expect("notes");
        fs::write(root.join("src").join("App.tsx"), "const answer = 1;\n").expect("app");
        Fixture { _dir: dir, root }
    }

    fn ops(root: &Path) -> FileOps<MemoryStore, Binned, impl Fn(&str) -> Vec<PathBuf>> {
        let folder = root.to_path_buf();
        FileOps::new(
            Guard::default(),
            MemoryStore::default(),
            Binned,
            move |workspace: &str| {
                if workspace == "w1" {
                    vec![folder.clone()]
                } else {
                    Vec::new()
                }
            },
        )
    }

    fn read_back(root: &Path, name: &str) -> String {
        fs::read_to_string(root.join(name)).expect("file reads")
    }

    #[test]
    fn an_edit_round_trips_through_undo() {
        let fx = fixture();
        let ops = ops(&fx.root);

        let edited = ops
            .edit("w1", "notes.md", "second", "third", 0, Some("chat-1"))
            .expect("edit");
        assert_eq!(edited.replaced, 1);
        assert_eq!(read_back(&fx.root, "notes.md"), "first line\nthird line\n");

        ops.revert(edited.checkpoint_id).expect("undo");
        assert_eq!(read_back(&fx.root, "notes.md"), "first line\nsecond line\n");
    }

    #[test]
    fn a_write_that_created_a_file_is_undone_by_removing_it() {
        let fx = fixture();
        let ops = ops(&fx.root);

        let written = ops
            .write("w1", "docs/deep/new.md", "hello\n", None)
            .expect("write");
        assert!(written.created);
        assert!(fx.root.join("docs/deep/new.md").exists());

        ops.revert(written.checkpoint_id).expect("undo");
        assert!(!fx.root.join("docs/deep/new.md").exists());
    }

    #[test]
    fn a_deleted_image_comes_back_byte_for_byte() {
        let fx = fixture();
        let ops = ops(&fx.root);
        let bytes = [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d];
        fs::write(fx.root.join("logo.png"), bytes).expect("png");

        let removed = ops.remove("w1", "logo.png", None).expect("delete");
        assert!(!fx.root.join("logo.png").exists());

        ops.revert(removed.checkpoint_id).expect("undo");
        assert_eq!(fs::read(fx.root.join("logo.png")).expect("restored"), bytes);
    }

    #[test]
    fn a_move_is_undone_to_where_it_came_from() {
        let fx = fixture();
        let ops = ops(&fx.root);

        let moved = ops
            .move_path("w1", "notes.md", "docs/notes.md", None)
            .expect("move");
        assert_eq!(moved.from, fx.root.join("notes.md"));

        let undone = ops.revert(moved.checkpoint_id).expect("undo");
        assert_eq!(undone.from, Some(fx.root.join("docs/notes.md")));
        assert_eq!(read_back(&fx.root, "notes.md"), "first line\nsecond line\n");
        assert!(!fx.root.join("docs/notes.md").exists());
    }

    #[test]
    fn an_undo_is_refused_once_the_folder_is_out_of_reach() {
        let fx = fixture();
        let folder = fx.root.clone();
        let open = Cell::new(true);
        let ops = FileOps::new(
            Guard::default(),
            MemoryStore::default(),
            Binned,
            |_: &str| {
                if open.get() {
                    vec![folder.clone()]
                } else {
                    Vec::new()
                }
            },
        );
        let edited = ops
            .edit("w1", "notes.md", "second", "third", 0, None)
            .expect("edit");

        // The project was closed: the row is still there, the reach is not.
        open.set(false);
        assert!(ops.revert(edited.checkpoint_id).is_err());
        assert_eq!(read_back(&fx.root, "notes.md"), "first line\nthird line\n");
    }

    #[test]
    fn a_data_url_is_written_as_the_bytes_it_carries() {
        let fx = fixture();
        let ops = ops(&fx.root);
        let raw = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
        let url = format!("data:image/png;base64,{}", STANDARD.encode(raw));

        ops.write("w1", "upload.png", &url, None).expect("write");
        assert_eq!(fs::read(fx.root.join("upload.png")).expect("written"), raw);
    }

    #[test]
    fn an_svg_comes_back_as_a_data_url_and_as_text() {
        let fx = fixture();
        let ops = ops(&fx.root);
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>"#;
        fs::write(fx.root.join("icon.svg"), svg).expect("svg");

        let opened = ops.read("w1", "icon.svg").expect("read");
        assert_eq!(opened.kind, ContentKind::Image);
        assert_eq!(opened.mime, Some("image/svg+xml"));
        assert_eq!(opened.text, svg);
        assert!(
            opened
                .data_url
                .is_some_and(|url| url.starts_with("data:image/svg+xml;base64,"))
        );
    }

    #[test]
    fn search_skips_credentials_and_generated_folders() {
        let fx = fixture();
        let ops = ops(&fx.root);
        fs::write(fx.root.join(".env"), "API_KEY=hunter2\n").expect("env");
        fs::create_dir_all(fx.root.join("node_modules")).expect("modules");
        fs::write(fx.root.join("node_modules/index.js"), "const answer = 2;\n").expect("module");
        fs::create_dir_all(fx.root.join(".ssh")).expect("ssh");
        fs::write(fx.root.join(".ssh/id_rsa"), "PRIVATE\n").expect("key");

        let by_text = ops
            .search(
                "w1",
                &Query {
                    text: "hunter2".into(),
                    ..Query::default()
                },
            )
            .expect("search");
        assert!(by_text.hits.is_empty());

        let by_name = ops
            .search(
                "w1",
                &Query {
                    name: "id_rsa".into(),
                    ..Query::default()
                },
            )
            .expect("search");
        assert!(by_name.hits.is_empty());

        let answers = ops
            .search(
                "w1",
                &Query {
                    text: "answer".into(),
                    ..Query::default()
                },
            )
            .expect("search");
        assert_eq!(answers.hits.len(), 1);
        assert_eq!(answers.hits[0].line, Some(1));
    }

    #[test]
    fn search_stops_at_its_limit_and_never_goes_past_fifty() {
        let fx = fixture();
        let ops = ops(&fx.root);
        for i in 0..60 {
            fs::write(fx.root.join(format!("hit{i:02}.txt")), "needle here\n").expect("hit");
        }

        let capped = ops
            .search(
                "w1",
                &Query {
                    text: "needle".into(),
                    limit: None,
                    ..Query::default()
                },
            )
            .expect("search");
        assert_eq!(capped.hits.len(), 50);

        let asked = ops
            .search(
                "w1",
                &Query {
                    text: "needle".into(),
                    limit: Some(3.0),
                    ..Query::default()
                },
            )
            .expect("search");
        assert_eq!(asked.hits.len(), 3);
        assert_eq!(asked.hits[0].line, Some(1));

        // TS quirk: Number(2.5) is kept, so the walk stops after three hits, not two.
        let fractional = ops
            .search(
                "w1",
                &Query {
                    text: "needle".into(),
                    limit: Some(2.5),
                    ..Query::default()
                },
            )
            .expect("search");
        assert_eq!(fractional.hits.len(), 3);
    }

    #[test]
    fn a_listing_puts_folders_first_and_ignores_case_when_sorting() {
        let fx = fixture();
        let ops = ops(&fx.root);
        fs::write(fx.root.join("Beta.md"), "").expect("beta");
        fs::write(fx.root.join("alpha.md"), "").expect("alpha");

        let listing = ops.list("w1", ".").expect("list");
        let names: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["src", "alpha.md", "Beta.md", "notes.md"]);
    }

    #[test]
    fn edits_refuse_missing_and_repeated_text() {
        let text = "same\nsame\n";
        assert!(apply_edit(text, "absent", "x", 0).is_err());
        assert!(apply_edit(text, "same", "x", 0).is_err());
        assert_eq!(
            apply_edit(text, "same", "x", 2).expect("two").next,
            "x\nx\n"
        );
        assert!(apply_edit(text, "", "x", 0).is_err());
    }

    #[test]
    fn a_name_is_the_last_piece_of_the_path() {
        assert_eq!(name_of("/work/project/src/App.tsx"), "App.tsx");
        assert_eq!(name_of("C:\\work\\notes.md"), "notes.md");
        assert_eq!(name_of("/"), "/");
    }
}
