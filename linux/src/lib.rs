//! Draggy for Linux. The widgets are in the binary; this library holds what can be checked without a display.

pub mod chat;
pub mod conversations;
pub mod runtime;
pub mod secrets;
pub mod settings;

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
}
