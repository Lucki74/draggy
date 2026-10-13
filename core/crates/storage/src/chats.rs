//! Chats and their messages: saving and loading, summaries, deletes, import and full-text search.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row, params};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value, json};

use crate::blobs::{collect_garbage, read_blob, write_blob};
use crate::js::{
    de_flag, de_number, de_text, is_truthy, js_text, now_millis, parse_any, parse_json, ser_number,
    sqlite_real_text, text_or_empty, utf16_prefix,
};
use crate::workspaces::DEFAULT_WORKSPACE_ID;
use crate::{Storage, StorageError};

/// How much of a message's text is indexed. Counted in UTF-16 units, like the Electron build counts them.
const SEARCH_BODY_UNITS: usize = 20_000;
const SEARCH_LIMIT: i64 = 50;

const UPSERT_CHAT: &str =
    "INSERT INTO chats (id, title, updated_at, is_out_of_context, compaction, workspace_id, plan)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       updated_at = excluded.updated_at,
       is_out_of_context = excluded.is_out_of_context,
       compaction = excluded.compaction,
       workspace_id = excluded.workspace_id,
       plan = excluded.plan";

const INSERT_MESSAGE: &str =
    "INSERT INTO messages (id, chat_id, position, role, payload) VALUES (?1, ?2, ?3, ?4, ?5)";
const INSERT_ATTACHMENT: &str = "INSERT INTO attachments (message_row_id, position, name, type, blob_hash) VALUES (?1, ?2, ?3, ?4, ?5)";
const INSERT_SEARCH: &str =
    "INSERT INTO message_search (chat_id, message_id, body) VALUES (?1, ?2, ?3)";

/// One attachment. Its bytes are stored as a blob; `content` is filled in when a chat is loaded.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub content: String,
    /// The name as the search index reads it, where a falsy name such as 0 keeps its text. None when built in code.
    #[serde(skip)]
    index_name: Option<String>,
}

impl Attachment {
    fn search_name(&self) -> &str {
        self.index_name.as_deref().unwrap_or(&self.name)
    }
}

/// One message. Every key it was sent with stays, in the order it was sent, so the payload matches the reference's.
/// Without a role it cannot be saved, as the reference's NOT NULL column refuses it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Message {
    /// The id as stored. A message sent with a falsy id is given `message-<position>` when a chat is read in.
    pub id: String,
    /// The role as sent. Text and numbers are stored; null is refused, as the reference refuses it.
    pub role: Value,
    /// Every key but `attachments`, with `id` and `role` where they were sent.
    pub fields: Map<String, Value>,
    pub attachments: Vec<Attachment>,
}

/// A chat with its messages. `plan` and `compaction` are kept as JSON; the store checks only what it needs.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    /// None is a row with no id, which the reference writes for a session sent without one.
    // TS quirk: such a row is never found again, since SQLite never matches NULL, so each save adds another.
    #[serde(deserialize_with = "de_chat_id")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "de_text")]
    pub title: String,
    #[serde(default, deserialize_with = "de_number", serialize_with = "ser_number")]
    pub updated_at: f64,
    #[serde(default, deserialize_with = "de_text")]
    pub workspace_id: String,
    #[serde(default)]
    pub plan: Option<Value>,
    #[serde(default, deserialize_with = "de_flag")]
    pub is_out_of_context: bool,
    /// Always false when loaded: a generation cannot survive a restart.
    #[serde(skip_deserializing, default)]
    pub is_generating: bool,
    #[serde(default)]
    pub compaction: Option<Value>,
    /// None when the session had no list of messages, which a save refuses.
    #[serde(default, deserialize_with = "de_messages")]
    pub messages: Option<Vec<Message>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: Option<String>,
    pub title: String,
    #[serde(serialize_with = "ser_number")]
    pub updated_at: f64,
    pub workspace_id: String,
    pub is_out_of_context: bool,
    pub message_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub chat_id: String,
    pub message_id: String,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub chats: i64,
    pub messages: i64,
    /// The number of attachment blobs, not of attachments: one image pasted twice counts once.
    pub attachments: i64,
    pub attachment_bytes: i64,
}

/// A chat row as stored, before its messages are read.
struct ChatRow {
    id: Option<String>,
    title: String,
    updated_at: f64,
    is_out_of_context: bool,
    compaction: Option<String>,
    workspace_id: Option<String>,
    plan: Option<String>,
}

impl Storage {
    /// Replaces a chat and its messages in one transaction. An unchanged id overwrites, never duplicates.
    pub fn save_chat(&self, chat: &Chat) -> Result<(), StorageError> {
        self.write("saveChat", |conn| {
            let tx = conn.transaction()?;
            save_in(&tx, &self.blob_dir, chat)?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn load_chats(&self) -> Result<Vec<Chat>, StorageError> {
        let conn = self.lock()?;
        chat_rows(&conn)?
            .into_iter()
            .map(|row| hydrate(&conn, &self.blob_dir, row))
            .collect()
    }

    pub fn load_chat_summaries(&self) -> Result<Vec<ChatSummary>, StorageError> {
        let conn = self.lock()?;
        let mut statement = conn.prepare_cached(
            "SELECT c.id, c.title, c.updated_at, c.is_out_of_context, c.workspace_id,
                    (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
             FROM chats c ORDER BY c.updated_at DESC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(ChatSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                    is_out_of_context: row.get::<_, i64>(3)? != 0,
                    workspace_id: or_default_workspace(row.get(4)?),
                    message_count: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_chat(&self, id: &str) -> Result<(), StorageError> {
        self.write("deleteChat", |conn| {
            conn.execute("DELETE FROM chats WHERE id = ?1", [id])?;
            conn.execute("DELETE FROM message_search WHERE chat_id = ?1", [id])?;
            collect_garbage(conn, &self.blob_dir)?;
            Ok(())
        })
    }

    pub fn clear_chats(&self) -> Result<(), StorageError> {
        self.write("clearChats", |conn| {
            conn.execute("DELETE FROM chats", [])?;
            conn.execute("DELETE FROM message_search", [])?;
            collect_garbage(conn, &self.blob_dir)?;
            Ok(())
        })
    }

    /// Full-text search over message bodies. A query the index cannot parse returns nothing, never an error.
    pub fn search_chats(&self, query: &str) -> Vec<SearchHit> {
        let term = crate::js::js_trim(query);
        if term.is_empty() {
            return Vec::new();
        }
        let pattern = format!("\"{}\"*", term.replace('"', "\"\""));

        let Ok(conn) = self.lock() else {
            return Vec::new();
        };
        let outcome = conn
            .prepare_cached(
                "SELECT s.chat_id, s.message_id, c.title,
                    snippet(message_search, 2, '[', ']', '…', 12) AS excerpt
             FROM message_search s
             JOIN chats c ON c.id = s.chat_id
             WHERE message_search MATCH ?1
             ORDER BY rank
             LIMIT ?2",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(params![pattern, SEARCH_LIMIT], |row| {
                        Ok(SearchHit {
                            chat_id: row.get(0)?,
                            message_id: row.get(1)?,
                            title: row.get(2)?,
                            excerpt: row.get(3)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()
            });

        match outcome {
            Ok(hits) => hits,
            Err(error) => {
                tracing::debug!(target: "storage.search", error = %error, "search refused the query");
                Vec::new()
            }
        }
    }

    /// Saves each session that has an id and skips the rest, as the reference's import reads them.
    /// Sessions arrive as the renderer sent them, so each is read the way that import reads it.
    pub fn import_sessions(&self, sessions: &[Value]) -> usize {
        if self.is_closed() {
            return 0;
        }
        let mut imported = 0;
        for session in sessions {
            let Some(id) = session.get("id").filter(|id| is_truthy(id)) else {
                continue;
            };
            let chat = match import_chat(session) {
                Ok(chat) => chat,
                Err(error) => {
                    tracing::error!(target: "storage.import", chat = %js_text(id), error = %error, "import failed for a chat");
                    continue;
                }
            };
            match self.save_chat(&chat) {
                Ok(()) => imported += 1,
                Err(error) => {
                    tracing::error!(target: "storage.import", chat = %js_text(id), error = %error, "import failed for a chat");
                }
            }
        }
        tracing::info!(target: "storage.import", imported, "imported chats");
        imported
    }

    pub fn stats(&self) -> Result<Stats, StorageError> {
        let conn = self.lock()?;
        let chats = conn.query_row("SELECT COUNT(*) FROM chats", [], |row| row.get(0))?;
        let messages = conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
        let (attachments, attachment_bytes) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM blobs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(Stats {
            chats,
            messages,
            attachments,
            attachment_bytes,
        })
    }
}

fn save_in(conn: &Connection, blob_dir: &Path, chat: &Chat) -> Result<(), StorageError> {
    let Some(messages) = chat.messages.as_deref() else {
        return Err(StorageError::MessagesMissing);
    };
    let updated_at = if chat.updated_at.is_nan() || chat.updated_at == 0.0 {
        now_millis() as f64
    } else {
        chat.updated_at
    };
    let workspace_id = if chat.workspace_id.is_empty() {
        DEFAULT_WORKSPACE_ID
    } else {
        chat.workspace_id.as_str()
    };
    let compaction = chat
        .compaction
        .as_ref()
        .filter(|value| is_truthy(value))
        .map(serde_json::to_string)
        .transpose()?;
    let plan = chat
        .plan
        .as_ref()
        .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()))
        .map(serde_json::to_string)
        .transpose()?;

    conn.prepare_cached(UPSERT_CHAT)?.execute(params![
        chat.id,
        chat.title,
        updated_at,
        chat.is_out_of_context,
        compaction,
        workspace_id,
        plan
    ])?;
    conn.execute("DELETE FROM messages WHERE chat_id = ?1", [&chat.id])?;
    conn.execute("DELETE FROM message_search WHERE chat_id = ?1", [&chat.id])?;

    let mut seen = HashSet::new();
    for (index, message) in messages.iter().enumerate() {
        let id = unique_message_id(&message.id, index, &mut seen);
        let role = role_value(&message.role)?;
        let payload = payload_json(message, &id)?;
        let position = i64::try_from(index).unwrap_or(i64::MAX);
        conn.prepare_cached(INSERT_MESSAGE)?
            .execute(params![id, chat.id, position, role, payload])?;
        let row_id = conn.last_insert_rowid();

        for (slot, attachment) in message.attachments.iter().enumerate() {
            let hash = write_blob(conn, blob_dir, &attachment.content)?;
            let slot = i64::try_from(slot).unwrap_or(i64::MAX);
            conn.prepare_cached(INSERT_ATTACHMENT)?.execute(params![
                row_id,
                slot,
                attachment.name,
                attachment.kind,
                hash
            ])?;
        }

        conn.prepare_cached(INSERT_SEARCH)?
            .execute(params![chat.id, id, search_body(message)])?;
    }
    Ok(())
}

/// The id a message is stored under. A repeat within one chat gets `-<position>` appended until it is unique.
/// Ids only need to be unique within a chat.
fn unique_message_id(id: &str, index: usize, seen: &mut HashSet<String>) -> String {
    let mut candidate = id.to_string();
    while seen.contains(&candidate) {
        candidate = format!("{candidate}-{index}");
    }
    seen.insert(candidate.clone());
    candidate
}

/// The role as the reference binds it: text as it is, a number as a REAL (which a text column reads as `5.0`).
/// Null, and anything that is not text or a number, cannot be bound.
fn role_value(role: &Value) -> Result<SqlValue, StorageError> {
    match role {
        Value::String(text) => Ok(SqlValue::Text(text.clone())),
        Value::Number(number) => Ok(number.as_f64().map_or(SqlValue::Null, SqlValue::Real)),
        Value::Null => Err(StorageError::MessageRoleMissing),
        _ => Err(StorageError::MessageRoleInvalid),
    }
}

/// The message as its payload: every key as it was sent, with the stored id written in where it sat.
fn payload_json(message: &Message, id: &str) -> Result<String, StorageError> {
    let mut payload = message.fields.clone();
    payload.insert("id".to_string(), Value::String(id.to_string()));
    payload.insert("role".to_string(), message.role.clone());
    Ok(serde_json::to_string(&payload)?)
}

/// The indexed text: content, text content, then attachment names, joined by newlines and cut at the cap.
fn search_body(message: &Message) -> String {
    let mut parts = vec![
        indexed_text(message.fields.get("content")),
        indexed_text(message.fields.get("textContent")),
    ];
    parts.extend(
        message
            .attachments
            .iter()
            .map(|attachment| attachment.search_name().to_string()),
    );
    utf16_prefix(&parts.join("\n"), SEARCH_BODY_UNITS)
}

/// JavaScript's `value || ""` for indexed text, then `String` of it: objects read as `[object Object]`,
/// arrays as their items joined by commas, and numbers without a trailing `.0`.
fn indexed_text(value: Option<&Value>) -> String {
    match value {
        Some(value) if is_truthy(value) => js_text(value),
        _ => String::new(),
    }
}

fn chat_rows(conn: &Connection) -> rusqlite::Result<Vec<ChatRow>> {
    let mut statement = conn.prepare_cached(
        "SELECT id, title, updated_at, is_out_of_context, compaction, workspace_id, plan
         FROM chats ORDER BY updated_at DESC",
    )?;
    statement
        .query_map([], |row: &Row<'_>| {
            Ok(ChatRow {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                is_out_of_context: row.get::<_, i64>(3)? != 0,
                compaction: row.get(4)?,
                workspace_id: row.get(5)?,
                plan: row.get(6)?,
            })
        })?
        .collect()
}

fn hydrate(conn: &Connection, blob_dir: &Path, row: ChatRow) -> Result<Chat, StorageError> {
    let stored: Vec<(i64, String)> = {
        let mut statement = conn.prepare_cached(
            "SELECT row_id, payload FROM messages WHERE chat_id = ?1 ORDER BY position ASC",
        )?;
        statement
            .query_map([&row.id], |message| Ok((message.get(0)?, message.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut messages = Vec::with_capacity(stored.len());
    for (row_id, payload) in stored {
        let mut message: Message = parse_any(&payload)?;
        message.attachments = load_attachments(conn, blob_dir, row_id)?;
        messages.push(message);
    }

    Ok(Chat {
        id: row.id,
        title: row.title,
        updated_at: row.updated_at,
        workspace_id: or_default_workspace(row.workspace_id),
        plan: parse_json(row.plan.as_deref()),
        is_out_of_context: row.is_out_of_context,
        is_generating: false,
        compaction: parse_compaction(row.compaction.as_deref()),
        messages: Some(messages),
    })
}

fn load_attachments(
    conn: &Connection,
    blob_dir: &Path,
    row_id: i64,
) -> Result<Vec<Attachment>, StorageError> {
    let mut statement = conn.prepare_cached(
        "SELECT name, type, blob_hash FROM attachments WHERE message_row_id = ?1 ORDER BY position ASC",
    )?;
    let rows = statement
        .query_map([row_id], |attachment| {
            Ok((attachment.get(0)?, attachment.get(1)?, attachment.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<(String, String, String)>>>()?;
    Ok(rows
        .into_iter()
        .map(|(name, kind, hash)| Attachment {
            name,
            kind,
            content: read_blob(blob_dir, &hash),
            ..Attachment::default()
        })
        .collect())
}

/// A stored summary is kept only with an index to anchor it and some text. Anything else reads as none:
/// losing a summary costs one idle generation, while failing the conversation over it costs the lot.
fn parse_compaction(text: Option<&str>) -> Option<Value> {
    let text = text.filter(|text| !text.is_empty())?;
    let value: Value = parse_any(text).ok()?;
    let anchored = value.get("throughIndex").is_some_and(Value::is_number);
    let has_text = value
        .get("summary")
        .and_then(Value::as_str)
        .is_some_and(|summary| !summary.is_empty());
    (anchored && has_text).then_some(value)
}

fn or_default_workspace(value: Option<String>) -> String {
    value
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| DEFAULT_WORKSPACE_ID.to_string())
}

/// A chat id as the reference binds it: text as it is, a number as a REAL, and null as no id at all.
/// Booleans, objects and lists cannot be bound, so they fail the save.
// TS quirk: a numeric chat id is stored as its REAL text, so 7 becomes "7.0", while a message id 7 becomes "7".
fn de_chat_id<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    match Value::deserialize(deserializer)? {
        Value::Null => Ok(None),
        Value::String(text) => Ok(Some(text)),
        Value::Number(number) => Ok(number.as_f64().map(sqlite_real_text)),
        _ => Err(D::Error::custom("a chat id must be text, a number or null")),
    }
}

/// The messages of a session. A list is read message by message; anything else is no list at all.
fn de_messages<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<Message>>, D::Error> {
    let Value::Array(items) = Value::deserialize(deserializer)? else {
        return Ok(None);
    };
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            // A falsy id is replaced by its position, as the reference's `id || message-<position>` does.
            let falsy_id = !is_truthy(item.get("id").unwrap_or(&Value::Null));
            let mut message: Message = serde_json::from_value(item).map_err(D::Error::custom)?;
            if falsy_id {
                message.id = format!("message-{index}");
            }
            Ok(message)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

/// One session as the reference's import saves it: only the fields that import reads, with each defaulted
/// the way its `||` default reads. The reference drops a session's plan and summary on import.
fn import_chat(session: &Value) -> Result<Chat, serde_json::Error> {
    let or = |key: &str, fallback: Value| {
        session
            .get(key)
            .filter(|value| is_truthy(value))
            .cloned()
            .unwrap_or(fallback)
    };
    let messages = session
        .get("messages")
        .filter(|messages| messages.is_array())
        .cloned()
        .unwrap_or_else(|| json!([]));
    serde_json::from_value(json!({
        "id": session.get("id").cloned().unwrap_or(Value::Null),
        "title": or("title", json!("")),
        "updatedAt": or("updatedAt", json!(now_millis())),
        "workspaceId": or("workspaceId", json!(DEFAULT_WORKSPACE_ID)),
        "isOutOfContext": session.get("isOutOfContext").is_some_and(is_truthy),
        "messages": messages,
    }))
}

impl Message {
    /// The message as the reference's `JSON.stringify` writes it: its keys, with the stored id and role in place.
    fn to_map(&self) -> Map<String, Value> {
        let mut map = self.fields.clone();
        map.insert("id".to_string(), Value::String(self.id.clone()));
        map.insert("role".to_string(), self.role.clone());
        map
    }
}

impl Serialize for Message {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = self.to_map();
        if !self.attachments.is_empty() {
            let attachments =
                serde_json::to_value(&self.attachments).map_err(serde::ser::Error::custom)?;
            map.insert("attachments".to_string(), attachments);
        }
        map.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Message {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let Value::Object(map) = Value::deserialize(deserializer)? else {
            return Err(D::Error::custom("a message must be an object"));
        };
        let attachments = match map.get("attachments") {
            Some(value) if is_truthy(value) => match value {
                Value::Array(items) => items
                    .iter()
                    .map(|item| {
                        attachment_from_value(item)
                            .ok_or_else(|| D::Error::custom("an attachment must be an object"))
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                _ => return Err(D::Error::custom("attachments must be a list")),
            },
            _ => Vec::new(),
        };
        let fields: Map<String, Value> = map
            .iter()
            .filter(|(key, _)| key.as_str() != "attachments")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Ok(Message {
            id: text_or_empty(fields.get("id")),
            role: fields.get("role").cloned().unwrap_or(Value::Null),
            fields,
            attachments,
        })
    }
}

impl<'de> Deserialize<'de> for Attachment {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        attachment_from_value(&value)
            .ok_or_else(|| D::Error::custom("an attachment must be an object"))
    }
}

/// An attachment the way the reference reads it. Null has no fields to read, so it is refused; other
/// values that have no name, type or content read as empty text.
fn attachment_from_value(value: &Value) -> Option<Attachment> {
    match value {
        Value::Null => None,
        Value::Object(map) => Some(Attachment {
            name: text_or_empty(map.get("name")),
            kind: text_or_empty(map.get("type")),
            content: text_or_empty(map.get("content")),
            // The reference joins the raw name into the index, so 0 reads as "0" there, and null as nothing.
            index_name: Some(map.get("name").map(js_text).unwrap_or_default()),
        }),
        _ => Some(Attachment {
            index_name: Some(String::new()),
            ..Attachment::default()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_without_an_id_takes_its_position_only_inside_a_list() {
        let chat: Chat = serde_json::from_value(json!({
            "id": "c",
            "messages": [{"role": "user", "id": 0}, {"role": "user", "id": "kept"}],
        }))
        .unwrap();
        let ids: Vec<String> = chat
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|message| message.id)
            .collect();
        assert_eq!(ids, ["message-0", "kept"]);
    }

    #[test]
    fn keeps_a_message_key_order_as_sent() {
        let message: Message =
            serde_json::from_value(json!({"role": "user", "content": "hi", "id": "m"})).unwrap();
        let map = message.to_map();
        let keys: Vec<&str> = map.keys().map(String::as_str).collect();
        assert_eq!(keys, ["role", "content", "id"]);
    }
}
