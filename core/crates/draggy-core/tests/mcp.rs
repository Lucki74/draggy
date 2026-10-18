//! The catalogue as the shell sees it.

use draggy_core::mcp_catalogue;

#[test]
fn a_blank_query_lists_every_server_with_a_name_and_a_docs_link() {
    let all = mcp_catalogue("  ".to_owned());

    assert!(all.len() > 50, "{} servers", all.len());
    assert!(all.iter().all(|server| !server.id.is_empty()));
    assert!(all.iter().all(|server| !server.name.is_empty()));
    assert!(all.iter().all(|server| !server.docs.is_empty()));
}

#[test]
fn a_query_narrows_the_list_and_ignores_case() {
    let all = mcp_catalogue(String::new());
    let first = &all[0];

    let found = mcp_catalogue(first.id.to_uppercase());

    assert!(found.iter().any(|server| server.id == first.id));
    assert!(found.len() < all.len());
}

#[test]
fn a_query_with_no_match_gives_an_empty_list() {
    assert!(mcp_catalogue("zzzz-no-such-server-zzzz".to_owned()).is_empty());
}
