//! The window colour before the page paints, chosen from the saved theme. Port of the colour logic in
//! electron/theme.cjs; a hardcoded dark one flashed every light-theme launch.

use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

/// `--surface-canvas` in src/index.css, for each theme.
const BACKGROUND_LIGHT: [u8; 3] = [0xf5, 0xf7, 0xf9];
const BACKGROUND_DARK: [u8; 3] = [0x0e, 0x10, 0x12];

/// The key the renderer saves its settings JSON under.
const SETTINGS_KEY: &str = "draggy_settings";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeSetting {
    Light,
    Dark,
    System,
}

/// The theme in the saved settings JSON. No settings means a new install, which follows the system.
pub fn theme_setting(raw_settings: Option<&str>) -> ThemeSetting {
    let settings = raw_settings
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    match settings.as_ref().and_then(|s| s.get("theme")?.as_str()) {
        Some("light") => ThemeSetting::Light,
        Some("dark") => ThemeSetting::Dark,
        _ => ThemeSetting::System,
    }
}

/// True when the resolved theme is dark.
pub fn resolved_dark(setting: ThemeSetting, system_is_dark: bool) -> bool {
    match setting {
        ThemeSetting::System => system_is_dark,
        ThemeSetting::Light => false,
        ThemeSetting::Dark => true,
    }
}

/// RGB of the canvas colour for the setting.
pub fn background_for(setting: ThemeSetting, system_is_dark: bool) -> [u8; 3] {
    if resolved_dark(setting, system_is_dark) {
        BACKGROUND_DARK
    } else {
        BACKGROUND_LIGHT
    }
}

/// Reads the saved settings from `draggy.db` without writing: the file may not exist yet, or be
/// open in an Electron build. Anything unreadable counts as no settings.
pub fn saved_settings(db: &Path) -> Option<String> {
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.query_row(
        "SELECT value FROM kv WHERE key = ?1",
        [SETTINGS_KEY],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_or_broken_settings_follow_the_system() {
        assert_eq!(theme_setting(None), ThemeSetting::System);
        assert_eq!(theme_setting(Some("")), ThemeSetting::System);
        assert_eq!(theme_setting(Some("{not json")), ThemeSetting::System);
        assert_eq!(
            theme_setting(Some(r#"{"theme":"neon"}"#)),
            ThemeSetting::System
        );
        assert_eq!(theme_setting(Some(r#"{"theme":3}"#)), ThemeSetting::System);
    }

    #[test]
    fn reads_the_saved_theme() {
        assert_eq!(
            theme_setting(Some(r#"{"theme":"light"}"#)),
            ThemeSetting::Light
        );
        assert_eq!(
            theme_setting(Some(r#"{"theme":"dark"}"#)),
            ThemeSetting::Dark
        );
        assert_eq!(
            theme_setting(Some(r#"{"theme":"system"}"#)),
            ThemeSetting::System
        );
    }

    #[test]
    fn picks_the_canvas_colour() {
        assert_eq!(background_for(ThemeSetting::Light, true), BACKGROUND_LIGHT);
        assert_eq!(background_for(ThemeSetting::Dark, false), BACKGROUND_DARK);
        assert_eq!(background_for(ThemeSetting::System, true), BACKGROUND_DARK);
        assert_eq!(
            background_for(ThemeSetting::System, false),
            BACKGROUND_LIGHT
        );
    }

    #[test]
    fn reads_settings_from_the_kv_table_and_tolerates_a_missing_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("draggy.db");
        assert_eq!(saved_settings(&db), None);

        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)")
            .unwrap();
        conn.execute(
            "INSERT INTO kv VALUES (?1, ?2)",
            [SETTINGS_KEY, r#"{"theme":"light"}"#],
        )
        .unwrap();
        drop(conn);
        assert_eq!(saved_settings(&db).as_deref(), Some(r#"{"theme":"light"}"#));
    }
}
