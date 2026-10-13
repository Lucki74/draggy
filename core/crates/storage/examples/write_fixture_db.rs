//! Regenerates `shared/fixtures/storage/rust-written.db`, the database the 1.2.7 reader must still open.
//! Run `cargo run -p draggy-storage --example write_fixture_db`, then regenerate `rust-written.expected.json`.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use draggy_storage::{Chat, CheckpointInput, MetricInput, Storage, Workspace};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn main() -> Result<(), Box<dyn Error>> {
    let out_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../shared/fixtures/storage");
    write_dataset(&out_dir)
}

/// Writes the representative dataset into `out_dir` as `rust-written.db` and `rust-written-blobs/`.
pub fn write_dataset(out_dir: &Path) -> Result<(), Box<dyn Error>> {
    let work = tempfile::tempdir()?;
    {
        let store = Storage::open(work.path())?;
        store.save_workspace(&from_json::<Workspace>(json!({
            "id": "project",
            "name": "Thing",
            "kind": "project",
            "rootPath": "/work/thing",
            "permissionMode": "acceptEdits",
            "settings": {"webMode": "off"},
            "grants": [{"tool": "write_file", "target": "/work/thing"}],
            "createdAt": 1000
        }))?)?;

        store.save_chat(&from_json::<Chat>(json!({
            "id": "from-2",
            "title": "Written by 2.0",
            "updatedAt": 2000,
            "workspaceId": "project",
            "isOutOfContext": false,
            "plan": [{"id": "p1", "text": "Do the thing", "status": "doing"}],
            "messages": [
                {
                    "id": "m1",
                    "role": "user",
                    "content": "hello from 2.0",
                    "attachments": [{"name": "shot.png", "type": "image/png", "content": "data:image/png;base64,iVBORw0KGgo="}]
                },
                {"id": "m2", "role": "assistant", "content": "hi", "textContent": "hi", "metrics": {"responseTokens": 5, "tokensPerSecond": 12.5}}
            ]
        }))?)?;

        store.save_chat(&from_json::<Chat>(json!({
            "id": "release",
            "title": "Plan the release",
            "updatedAt": 3000,
            "isOutOfContext": true,
            "compaction": {"throughIndex": 0, "summary": "Release is on Friday.", "updatedAt": 2500},
            "messages": [{"id": "r1", "role": "user", "content": "when is the release?", "textContent": "when is the release?"}]
        }))?)?;

        store.record_metric(&from_json::<MetricInput>(json!({
            "recordedAt": 4000,
            "workspaceId": "project",
            "chatId": "from-2",
            "model": "qwen3:8b",
            "promptTokens": 120,
            "responseTokens": 30,
            "responseMs": 900,
            "firstTokenMs": 210,
            "loadMs": 0,
            "taskMs": 1200,
            "loops": 1,
            "tools": {"read_file": 1}
        }))?)?;

        store.add_checkpoint(&from_json::<CheckpointInput>(json!({
            "workspaceId": "project",
            "chatId": "from-2",
            "path": "/work/thing/notes.md",
            "action": "write",
            "beforeHash": null,
            "afterHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "createdAt": 4500
        }))?)?;

        store.set_value("draggy_settings", r#"{"theme":"dark"}"#)?;
    }

    let target = out_dir.join("rust-written.db");
    let blobs = out_dir.join("rust-written-blobs");
    fs::copy(work.path().join("draggy.db"), &target)?;
    if blobs.exists() {
        fs::remove_dir_all(&blobs)?;
    }
    copy_dir(&work.path().join("blobs"), &blobs)?;
    Ok(())
}

fn from_json<T: DeserializeOwned>(value: Value) -> Result<T, serde_json::Error> {
    serde_json::from_value(value)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
