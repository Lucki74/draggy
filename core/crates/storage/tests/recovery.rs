//! Damaged databases: what is kept aside, what is rescued, and what the store promises to its callers.

use std::fs;
use std::path::Path;

use draggy_storage::{Chat, Storage};
use serde_json::json;

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn storage_can_be_shared_across_threads() {
    assert_send_sync::<Storage>();
}

#[test]
fn a_file_that_is_not_a_database_is_kept_aside() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::write(
        dir.path().join("draggy.db"),
        "this is not a database at all",
    )
    .expect("write garbage");

    let store = Storage::open(dir.path()).expect("open starts clean");
    store
        .save_chat(&chat("fresh"))
        .expect("the fresh database takes a save");

    let kept = quarantined(dir.path());
    assert_eq!(
        kept.len(),
        1,
        "exactly one quarantined file, found {kept:?}"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join(&kept[0])).expect("read the kept file"),
        "this is not a database at all",
        "the damaged bytes are kept, not deleted"
    );
    assert_eq!(store.load_chats().expect("chats load").len(), 1);
}

#[test]
fn a_rebuild_keeps_the_damaged_file_and_rescues_its_chats() {
    let dir = tempfile::tempdir().expect("temp dir");
    {
        let store = Storage::open(dir.path()).expect("open");
        store.save_chat(&chat("keep")).expect("save");
    }
    {
        let conn = rusqlite::Connection::open(dir.path().join("draggy.db")).expect("open file");
        conn.execute_batch("DROP TABLE message_search_data")
            .expect("break the search index");
    }

    let store = Storage::open(dir.path()).expect("open rebuilds");

    assert_eq!(
        quarantined(dir.path()).len(),
        1,
        "the damaged file is kept beside the new one"
    );
    let chats = store.load_chats().expect("chats load");
    assert_eq!(
        chats
            .iter()
            .map(|chat| chat.id.as_deref().unwrap_or_default())
            .collect::<Vec<_>>(),
        ["keep"]
    );
    assert_eq!(
        chats[0].workspace_id, "default",
        "a rescued chat lands in the default workspace"
    );
}

#[test]
fn a_clean_open_keeps_no_quarantined_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    {
        let store = Storage::open(dir.path()).expect("open");
        store.save_chat(&chat("a")).expect("save");
    }
    let _reopened = Storage::open(dir.path()).expect("reopen");

    assert!(quarantined(dir.path()).is_empty());
}

fn chat(id: &str) -> Chat {
    serde_json::from_value(json!({
        "id": id,
        "title": format!("Chat {id}"),
        "updatedAt": 1000,
        "messages": [{"id": "m1", "role": "user", "content": "important message"}]
    }))
    .expect("a chat deserialises")
}

fn quarantined(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .expect("read the folder")
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.contains(".corrupt-"))
        .collect()
}
