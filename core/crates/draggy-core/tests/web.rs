//! The browser pane's address policy as the shell calls it.

use draggy_core::{web_address_allowed, web_address_refusal};

#[test]
fn public_web_pages_are_allowed() {
    assert!(web_address_allowed(
        "https://example.com/a?b=1".to_owned(),
        false
    ));
    assert!(web_address_allowed("http://example.com".to_owned(), false));
}

#[test]
fn other_schemes_are_refused_even_for_the_user() {
    for address in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "about:blank",
        "draggy://settings",
    ] {
        assert!(!web_address_allowed(address.to_owned(), true), "{address}");
    }
}

#[test]
fn local_addresses_need_the_private_flag() {
    assert!(!web_address_allowed(
        "http://localhost:5173".to_owned(),
        false
    ));
    assert!(web_address_allowed(
        "http://localhost:5173".to_owned(),
        true
    ));
    assert!(!web_address_allowed(
        "http://192.168.1.10".to_owned(),
        false
    ));
}

#[test]
fn a_refusal_has_a_reason_and_an_allowed_address_has_none() {
    assert!(web_address_refusal("https://example.com".to_owned(), false).is_empty());
    assert!(!web_address_refusal("file:///etc/passwd".to_owned(), true).is_empty());
}
