//! Address handling for the Browser page, kept apart from the widgets so it can be tested without a display.

use draggy_core::web_address_allowed;

/// Adds `https://` to what the user typed when it has no scheme.
pub fn normalize(typed: &str) -> String {
    let text = typed.trim();
    if text.is_empty() || text.contains("://") {
        return text.to_owned();
    }
    format!("https://{text}")
}

/// Whether the page may load `address`: http and https only, and local servers stay open to the user.
pub fn permits(address: &str) -> bool {
    web_address_allowed(address.to_owned(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_host_gets_https() {
        assert_eq!(normalize("  example.com/a "), "https://example.com/a");
        assert_eq!(normalize("http://localhost:8080"), "http://localhost:8080");
        assert_eq!(normalize(" "), "");
    }

    #[test]
    fn only_web_addresses_load() {
        assert!(permits("https://example.com"));
        assert!(permits("http://127.0.0.1:8080"));
        assert!(!permits("file:///etc/passwd"));
        assert!(!permits("javascript:alert(1)"));
    }
}
