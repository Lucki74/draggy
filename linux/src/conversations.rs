//! Saved conversations: one JSON file per conversation under the user's data directory. Nothing here needs a display,
//! so the store is covered by `cargo test --lib`.

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// The most characters a title keeps. A longer first message is cut and ends in an ellipsis.
const TITLE_CHARS: usize = 60;

/// The longest id the store accepts. Ids become file names, so they are kept short and plain.
const ID_CHARS: usize = 64;

/// One message as it is written to disk. It mirrors `draggy_core::MessageRecord`; the chat converts between the two.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

/// A whole conversation as it is written to disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    /// Seconds since the Unix epoch, when the conversation was last saved.
    pub updated: u64,
    pub messages: Vec<SavedMessage>,
}

/// What a list shows about a conversation, without its messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub updated: u64,
}

/// The folder that holds the conversation files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The store under `$XDG_DATA_HOME/draggy/conversations`, falling back to `~/.local/share` when that variable is
    /// unset or relative. `None` when there is no home directory either.
    pub fn in_data_dir() -> Option<Self> {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })?;
        Some(Self::new(base.join("draggy").join("conversations")))
    }

    /// Every readable conversation, newest first. A file that cannot be read or parsed is skipped. A missing folder
    /// holds no conversations.
    pub fn list(&self) -> io::Result<Vec<Summary>> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut summaries: Vec<Summary> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "json")
            })
            .filter_map(|path| fs::read_to_string(path).ok())
            .filter_map(|text| serde_json::from_str::<Conversation>(&text).ok())
            .map(|conversation| Summary {
                id: conversation.id,
                title: conversation.title,
                updated: conversation.updated,
            })
            .collect();
        summaries.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.id.cmp(&b.id)));
        Ok(summaries)
    }

    pub fn load(&self, id: &str) -> io::Result<Conversation> {
        let text = fs::read_to_string(self.path_for(id)?)?;
        serde_json::from_str(&text).map_err(invalid_data)
    }

    /// Writes the conversation over its old file. The text goes to a temporary file first, so a crash leaves the old
    /// copy in place.
    pub fn save(&self, conversation: &Conversation) -> io::Result<()> {
        let path = self.path_for(&conversation.id)?;
        let text = serde_json::to_string_pretty(conversation).map_err(invalid_data)?;
        fs::create_dir_all(&self.dir)?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, text)?;
        fs::rename(&temporary, &path)
    }

    pub fn delete(&self, id: &str) -> io::Result<()> {
        fs::remove_file(self.path_for(id)?)
    }

    fn path_for(&self, id: &str) -> io::Result<PathBuf> {
        if !is_valid_id(id) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the conversation id is not valid",
            ));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }
}

fn invalid_data(error: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_CHARS
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// A new id: the time in nanoseconds plus a counter, so two conversations started in the same instant still differ.
pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{count:x}")
}

/// Seconds since the Unix epoch, now.
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The title: the first line of the first user message, cut to a short length. A conversation with no such text is
/// called "New conversation".
pub fn title_for(messages: &[SavedMessage]) -> String {
    let first = messages
        .iter()
        .find(|message| message.role == "user")
        .map_or("", |message| message.content.as_str());
    let line = first
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.is_empty() {
        return "New conversation".to_owned();
    }
    let mut title: String = line.chars().take(TITLE_CHARS).collect();
    if line.chars().count() > TITLE_CHARS {
        title.push('…');
    }
    title
}

/// A folder under the system temp directory for one test, removed when the guard drops.
#[cfg(test)]
struct TestDir(PathBuf);

#[cfg(test)]
impl TestDir {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("draggy-conversations-{}", new_id())))
    }

    fn store(&self) -> Store {
        Store::new(&self.0)
    }
}

#[cfg(test)]
impl Drop for TestDir {
    fn drop(&mut self) {
        drop(fs::remove_dir_all(&self.0));
    }
}

#[cfg(test)]
fn conversation(id: &str, updated: u64, text: &str) -> Conversation {
    let messages = vec![
        SavedMessage {
            id: "m1".to_owned(),
            role: "user".to_owned(),
            content: text.to_owned(),
        },
        SavedMessage {
            id: "m2".to_owned(),
            role: "assistant".to_owned(),
            content: "Answer".to_owned(),
        },
    ];
    Conversation {
        id: id.to_owned(),
        title: title_for(&messages),
        updated,
        messages,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_conversation_loads_back_unchanged() {
        let dir = TestDir::new();
        let store = dir.store();
        let saved = conversation("abc-1", 10, "Hello there");
        store.save(&saved).expect("saved");
        assert_eq!(store.load("abc-1").expect("loaded"), saved);
    }

    #[test]
    fn the_list_is_newest_first_and_skips_bad_files() {
        let dir = TestDir::new();
        let store = dir.store();
        store.save(&conversation("old", 1, "first")).expect("saved");
        store
            .save(&conversation("new", 5, "second"))
            .expect("saved");
        fs::write(dir.0.join("broken.json"), "{ not json").expect("written");
        fs::write(dir.0.join("notes.txt"), "ignored").expect("written");
        let ids: Vec<String> = store
            .list()
            .expect("listed")
            .into_iter()
            .map(|summary| summary.id)
            .collect();
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn a_missing_folder_has_no_conversations() {
        let dir = TestDir::new();
        assert!(dir.store().list().expect("listed").is_empty());
    }

    #[test]
    fn delete_removes_the_conversation() {
        let dir = TestDir::new();
        let store = dir.store();
        store.save(&conversation("gone", 1, "bye")).expect("saved");
        store.delete("gone").expect("deleted");
        assert!(store.load("gone").is_err());
        assert!(store.list().expect("listed").is_empty());
    }

    #[test]
    fn ids_that_could_escape_the_folder_are_refused() {
        let dir = TestDir::new();
        let store = dir.store();
        let too_long = "x".repeat(ID_CHARS + 1);
        for bad in ["", "../escape", "a/b", "a.b", too_long.as_str()] {
            let error = store.load(bad).expect_err("refused");
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        }
    }

    #[test]
    fn new_ids_are_valid_and_differ() {
        let first = new_id();
        let second = new_id();
        assert_ne!(first, second);
        assert!(is_valid_id(&first));
    }

    #[test]
    fn the_title_is_the_first_user_line() {
        let messages = [SavedMessage {
            id: "m1".to_owned(),
            role: "user".to_owned(),
            content: "\n  Plan my trip  \nmore detail".to_owned(),
        }];
        assert_eq!(title_for(&messages), "Plan my trip");
    }

    #[test]
    fn a_long_title_is_cut_with_an_ellipsis() {
        let long = "word ".repeat(40);
        let messages = [SavedMessage {
            id: "m1".to_owned(),
            role: "user".to_owned(),
            content: long,
        }];
        let title = title_for(&messages);
        assert_eq!(title.chars().count(), TITLE_CHARS + 1);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn a_conversation_without_user_text_is_untitled() {
        assert_eq!(title_for(&[]), "New conversation");
        let only_assistant = [SavedMessage {
            id: "m1".to_owned(),
            role: "assistant".to_owned(),
            content: "Hi".to_owned(),
        }];
        assert_eq!(title_for(&only_assistant), "New conversation");
    }
}
