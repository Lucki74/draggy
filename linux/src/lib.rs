//! Draggy for Linux. The widgets are in the binary; this library holds what can be checked without a display.

pub mod browser;
pub mod chat;
pub mod conversations;
pub mod markdown;
pub mod models;
pub mod preview;
pub mod runtime;
pub mod secrets;
pub mod servers;
pub mod services;
pub mod settings;
pub mod speech;
pub mod talk;

/// The D-Bus name and desktop file id of the app.
pub const APP_ID: &str = "com.draggy.Draggy";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_id_is_a_valid_dbus_name() {
        assert!(APP_ID.split('.').count() >= 3);
        assert!(
            APP_ID
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.')
        );
    }

    #[test]
    fn test_linux_parity_services() {
        use crate::services::ad_blocker::AdBlocker;
        use crate::services::diff_parser::parse_git_diff;
        use crate::services::mcp_auth_callback::McpAuthCallback;
        use crate::services::shell_detection::default_shell;
        use crate::services::vad::VadDetector;

        let shell = default_shell();
        assert!(!shell.name.is_empty());

        let diff = parse_git_diff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n-1\n+2\n");
        assert_eq!(diff.len(), 1);

        let vad = VadDetector::default();
        assert!(!vad.is_speech(&[0.0, 0.001]));
        assert!(vad.is_speech(&[0.3, 0.4]));

        let blocker = AdBlocker::new();
        assert!(blocker.is_blocked("https://doubleclick.net/ad"));
        assert!(!blocker.is_blocked("https://gnu.org"));

        let code = McpAuthCallback::extract_code("code=auth123&state=xyz");
        assert_eq!(code, Some("auth123".to_string()));
    }
}
