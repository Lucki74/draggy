use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::js::{
    de_items, de_number, de_optional_text, de_text, js_trim, now_millis, parse_json, ser_number,
};
use crate::{Storage, StorageError};

/// The workspace chats belong to until moved. A real row, so no code has to special-case "no workspace".
pub const DEFAULT_WORKSPACE_ID: &str = "default";

const COLUMNS: &str =
    "id, name, kind, root_path, permission_mode, settings, grants, created_at, updated_at";

const UPSERT: &str = "INSERT INTO workspaces (id, name, kind, root_path, permission_mode, settings, grants, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       root_path = excluded.root_path,
       permission_mode = excluded.permission_mode,
       settings = excluded.settings,
       grants = excluded.grants,
       updated_at = excluded.updated_at";

/// Only `project` is a project; any other value, or none, saves and reads as a chat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Project,
    #[default]
    Chat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    #[serde(default, deserialize_with = "de_text")]
    pub id: String,
    #[serde(default, deserialize_with = "de_text")]
    pub name: String,
    #[serde(default, deserialize_with = "de_kind")]
    pub kind: WorkspaceKind,
    #[serde(default, deserialize_with = "de_optional_text")]
    pub root_path: Option<String>,
    #[serde(default, deserialize_with = "de_text")]
    pub permission_mode: String,
    #[serde(default = "empty_object")]
    pub settings: Value,
    #[serde(default, deserialize_with = "de_items")]
    pub grants: Vec<Value>,
    #[serde(default, deserialize_with = "de_number", serialize_with = "ser_number")]
    pub created_at: f64,
    #[serde(default, deserialize_with = "de_number", serialize_with = "ser_number")]
    pub updated_at: f64,
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

/// A workspace as the reader returns one with nothing saved: empty settings, as an unreadable column reads.
impl Default for Workspace {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: WorkspaceKind::default(),
            root_path: None,
            permission_mode: String::new(),
            settings: empty_object(),
            grants: Vec::new(),
            created_at: 0.0,
            updated_at: 0.0,
        }
    }
}

impl Storage {
    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, StorageError> {
        let conn = self.lock()?;
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM workspaces ORDER BY created_at ASC"
        ))?;
        let rows = statement
            .query_map([], workspace_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_workspace(&self, id: &str) -> Result<Option<Workspace>, StorageError> {
        let conn = self.lock()?;
        conn.query_row(
            &format!("SELECT {COLUMNS} FROM workspaces WHERE id = ?1"),
            [id],
            workspace_from_row,
        )
        .optional()
        .map_err(StorageError::from)
    }

    /// Creates or edits a workspace. Its creation time is kept on edit; its update time is always now.
    pub fn save_workspace(&self, workspace: &Workspace) -> Result<Workspace, StorageError> {
        self.ensure_open()?;
        let id = js_trim(&workspace.id);
        if id.is_empty() {
            return Err(StorageError::WorkspaceIdMissing);
        }

        let now = now_millis() as f64;
        let kind = match workspace.kind {
            WorkspaceKind::Project => "project",
            WorkspaceKind::Chat => "chat",
        };
        let root = workspace
            .root_path
            .as_deref()
            .filter(|path| !path.is_empty());
        // Settings are stored when the reference's Object.keys would list something, so a list or text is kept too.
        let settings = match &workspace.settings {
            Value::Object(map) if !map.is_empty() => {
                Some(serde_json::to_string(&workspace.settings)?)
            }
            Value::Array(items) if !items.is_empty() => {
                Some(serde_json::to_string(&workspace.settings)?)
            }
            Value::String(text) if !text.is_empty() => {
                Some(serde_json::to_string(&workspace.settings)?)
            }
            _ => None,
        };
        let grants = if workspace.grants.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&workspace.grants)?)
        };
        let permission = if workspace.permission_mode.is_empty() {
            "ask"
        } else {
            workspace.permission_mode.as_str()
        };
        let created_at = if workspace.created_at.is_nan() || workspace.created_at == 0.0 {
            now
        } else {
            workspace.created_at
        };

        self.write("saveWorkspace", |conn| {
            conn.prepare_cached(UPSERT)?.execute(params![
                id,
                workspace.name,
                kind,
                root,
                permission,
                settings,
                grants,
                created_at,
                now
            ])?;
            let saved = conn.query_row(
                &format!("SELECT {COLUMNS} FROM workspaces WHERE id = ?1"),
                [id],
                workspace_from_row,
            )?;
            Ok(saved)
        })
    }

    /// Removes a project and every chat in it. The folder on disk is never touched. Returns how many chats went.
    pub fn delete_workspace(&self, id: &str) -> Result<usize, StorageError> {
        self.ensure_open()?;
        if id == DEFAULT_WORKSPACE_ID {
            return Err(StorageError::DefaultWorkspace);
        }

        self.write("deleteWorkspace", |conn| {
            // TS quirk: the reference runs these deletes one statement at a time with no transaction, so a
            // failure part-way leaves some of the project's chats removed. This mirrors that order.
            let chat_ids: Vec<Option<String>> = {
                let mut statement = conn.prepare("SELECT id FROM chats WHERE workspace_id = ?1")?;
                statement
                    .query_map([id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for chat_id in &chat_ids {
                conn.execute("DELETE FROM chats WHERE id = ?1", [chat_id])?;
                conn.execute("DELETE FROM message_search WHERE chat_id = ?1", [chat_id])?;
            }
            conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
            if !chat_ids.is_empty() {
                crate::blobs::collect_garbage(conn, &self.blob_dir)?;
            }
            Ok(chat_ids.len())
        })
    }
}

/// The kind the way the reference reads it: strictly `project`, and anything else is a chat.
fn de_kind<'de, D: Deserializer<'de>>(deserializer: D) -> Result<WorkspaceKind, D::Error> {
    Value::deserialize(deserializer).map(|value| {
        if value.as_str() == Some("project") {
            WorkspaceKind::Project
        } else {
            WorkspaceKind::Chat
        }
    })
}

/// Makes sure the default workspace exists and adopts chats that never had one. Runs on every open,
/// since it is what lets a 1.x database show its conversations.
pub(crate) fn ensure_default(conn: &Connection) -> Result<(), StorageError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO workspaces (id, name, kind, root_path, permission_mode, settings, grants, created_at, updated_at)
         VALUES (?1, '', 'chat', NULL, 'auto', NULL, NULL, ?2, ?2)
         ON CONFLICT(id) DO NOTHING",
        params![DEFAULT_WORKSPACE_ID, now],
    )?;
    let adopted = conn.execute(
        "UPDATE chats SET workspace_id = ?1 WHERE workspace_id IS NULL",
        [DEFAULT_WORKSPACE_ID],
    )?;
    if adopted > 0 {
        tracing::info!(target: "storage.workspaces", chats = adopted, "moved chats into the default workspace");
    }
    Ok(())
}

/// Reads a row the way the Electron build does: unreadable JSON falls back to nothing, not to an error.
fn workspace_from_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    let kind: String = row.get("kind")?;
    let settings = parse_json(row.get::<_, Option<String>>("settings")?.as_deref())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let grants = match parse_json(row.get::<_, Option<String>>("grants")?.as_deref()) {
        Some(Value::Array(items)) => items,
        _ => Vec::new(),
    };
    let permission: String = row.get("permission_mode")?;

    Ok(Workspace {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: if kind == "project" {
            WorkspaceKind::Project
        } else {
            WorkspaceKind::Chat
        },
        root_path: row
            .get::<_, Option<String>>("root_path")?
            .filter(|path| !path.is_empty()),
        permission_mode: if permission.is_empty() {
            "ask".to_string()
        } else {
            permission
        },
        settings,
        grants,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_workspace_built_in_code_has_empty_settings_like_a_read_one() {
        assert_eq!(Workspace::default().settings, json!({}));
    }
}
