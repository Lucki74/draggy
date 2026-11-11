//! A database written by this build must still open and read in 1.2.7, which a user may roll back to.
//! The schema and queries are the ones in `electron/fixtures/v1.2.7/storage.cjs`.

use draggy_storage::{Chat, Storage};
use rusqlite::Connection;
use serde_json::json;

const FIXTURE: &str = include_str!("../../electron/fixtures/v1.2.7/storage.cjs");

/// The `SCHEMA` template literal of the 1.2.7 storage module.
fn old_schema() -> &'static str {
    let start = FIXTURE.find("const SCHEMA = `").expect("schema start") + "const SCHEMA = `".len();
    let end = start + FIXTURE[start..].find("`;").expect("schema end");
    &FIXTURE[start..end]
}

#[test]
fn a_database_written_now_opens_and_reads_under_the_1_2_7_schema() {
    let dir = tempfile::tempdir().expect("tempdir");
    let chat: Chat = serde_json::from_value(json!({
        "id": "c1",
        "title": "Rollback",
        "updatedAt": 1_700_000_000_000_i64,
        "workspaceId": "default",
        "messages": [
            { "id": "m1", "role": "user", "content": "hello there",
              "attachments": [{ "name": "a.txt", "type": "text/plain", "content": "attached" }] },
            { "id": "m2", "role": "assistant", "content": "hi" }
        ]
    }))
    .expect("chat");
    {
        let storage = Storage::open(dir.path()).expect("open");
        storage.save_chat(&chat).expect("save");
        storage.set_value("k", "v").expect("kv");
        storage.close();
    }

    let conn = Connection::open(dir.path().join("draggy.db")).expect("raw open");
    conn.execute_batch(old_schema())
        .expect("1.2.7 schema applies");

    let check: String = conn
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .expect("quick_check");
    assert_eq!(check, "ok");
    let _: String = conn
        .query_row(
            "SELECT value FROM kv WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .expect("schema_version row");
    let searchable: i64 = conn
        .query_row("SELECT COUNT(*) FROM message_search", [], |row| row.get(0))
        .expect("search count");
    assert_eq!(searchable, 2);

    let (id, title, updated_at): (String, String, i64) = conn
        .query_row(
            "SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("chat row");
    assert_eq!(
        (id.as_str(), title.as_str(), updated_at),
        ("c1", "Rollback", 1_700_000_000_000)
    );

    let mut messages = conn
        .prepare(
            "SELECT row_id, id, role, payload FROM messages WHERE chat_id = ?1 ORDER BY position",
        )
        .expect("prepare");
    let rows: Vec<(i64, String, String)> = messages
        .query_map(["c1"], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");
    assert_eq!(
        rows.iter().map(|r| r.1.as_str()).collect::<Vec<_>>(),
        ["m1", "m2"]
    );

    let (name, kind, hash): (String, String, String) = conn
        .query_row(
            "SELECT name, type, blob_hash FROM attachments WHERE message_row_id = ?1 ORDER BY position",
            [rows[0].0],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("attachment");
    assert_eq!((name.as_str(), kind.as_str()), ("a.txt", "text/plain"));
    let blob = std::fs::read_to_string(dir.path().join("blobs").join(&hash[..2]).join(&hash))
        .expect("blob");
    assert_eq!(blob, "attached");
}
