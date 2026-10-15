//! What the user typed in the settings: where the model server is, which model, which folder. Held in memory only.
//! The API key is not part of this value; it lives in the Secret Service (see `secrets`).

use draggy_core::{PermissionModeRecord, SessionConfig};

/// The values the settings page edits.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Settings {
    pub server_url: String,
    pub model: String,
    pub folder: String,
    pub allow_commands: bool,
}

/// Why the settings cannot start a session yet. The text is worded for the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    NoServer,
    BadServer,
    NoModel,
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NoServer => "Enter the address of the model server in Settings.",
            Self::BadServer => "The server address must start with http:// or https://.",
            Self::NoModel => "Enter the name of the model in Settings.",
        })
    }
}

impl std::error::Error for SettingsError {}

impl Settings {
    /// The session configuration these settings describe, or the reason there is none.
    pub fn session_config(&self, api_key: Option<String>) -> Result<SessionConfig, SettingsError> {
        let server = self.server_url.trim().trim_end_matches('/');
        if server.is_empty() {
            return Err(SettingsError::NoServer);
        }
        if !(server.starts_with("http://") || server.starts_with("https://")) {
            return Err(SettingsError::BadServer);
        }
        let model = self.model.trim();
        if model.is_empty() {
            return Err(SettingsError::NoModel);
        }
        let folder = self.folder.trim();
        Ok(SessionConfig {
            base_url: server.to_owned(),
            model: model.to_owned(),
            api_key: api_key.filter(|key| !key.is_empty()),
            folder: (!folder.is_empty()).then(|| folder.to_owned()),
            context_tokens: None,
            loop_limit: None,
            allow_commands: self.allow_commands && !folder.is_empty(),
            permission_mode: Some(PermissionModeRecord::Ask),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filled() -> Settings {
        Settings {
            server_url: " http://127.0.0.1:8080/v1/ ".into(),
            model: " qwen ".into(),
            folder: "/home/me/project".into(),
            allow_commands: true,
        }
    }

    #[test]
    fn values_are_trimmed_and_the_trailing_slash_goes() {
        let config = filled().session_config(Some("k".into())).expect("valid");
        assert_eq!(config.base_url, "http://127.0.0.1:8080/v1");
        assert_eq!(config.model, "qwen");
        assert_eq!(config.api_key.as_deref(), Some("k"));
        assert!(config.allow_commands);
    }

    #[test]
    fn commands_need_a_folder() {
        let settings = Settings {
            folder: String::new(),
            ..filled()
        };
        let config = settings.session_config(None).expect("valid");
        assert!(config.folder.is_none());
        assert!(!config.allow_commands);
    }

    #[test]
    fn an_empty_key_is_no_key() {
        let config = filled().session_config(Some(String::new())).expect("valid");
        assert!(config.api_key.is_none());
    }

    #[test]
    fn missing_pieces_are_named() {
        let none = Settings::default();
        assert_eq!(none.session_config(None), Err(SettingsError::NoServer));
        let bad = Settings {
            server_url: "localhost:8080".into(),
            ..filled()
        };
        assert_eq!(bad.session_config(None), Err(SettingsError::BadServer));
        let no_model = Settings {
            model: " ".into(),
            ..filled()
        };
        assert_eq!(no_model.session_config(None), Err(SettingsError::NoModel));
    }
}
