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

#[test]
fn mcp_manager_starts_empty_and_reports_server_states() {
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let manager = draggy_core::McpManager::new(None, None).expect("manager");

    runtime.block_on(async {
        assert!(manager.list().await.is_empty());
        assert!(!manager.is_running("docs".to_owned()).await);

        // Starting a missing server gives an error state.
        let state = manager.start("no-such-server".to_owned(), None).await;
        assert_eq!(state.status, "error");
        assert!(state.error.is_some());

        // Stopping an unstarted server returns true (no-op).
        assert!(manager.stop("no-such-server".to_owned()).await);
    });
}

#[test]
fn server_config_record_converts_env_and_arguments() {
    let mut env = std::collections::HashMap::new();
    env.insert("API_KEY".to_owned(), "secret".to_owned());
    let mut arguments = std::collections::HashMap::new();
    arguments.insert("dir".to_owned(), "/tmp".to_owned());
    let record = draggy_core::McpServerConfigRecord {
        url: Some("https://example.com/mcp".to_owned()),
        name: Some("custom".to_owned()),
        package: Some("@example/mcp".to_owned()),
        args: Some(vec!["--flag".to_owned()]),
        env,
        arguments,
    };
    let config = draggy_mcp::definition::ServerConfig::from(record);
    assert_eq!(config.url.as_deref(), Some("https://example.com/mcp"));
    assert_eq!(config.name.as_deref(), Some("custom"));
    assert_eq!(config.package.as_deref(), Some("@example/mcp"));
    assert_eq!(config.args.as_deref(), Some(&["--flag".to_owned()][..]));
    assert_eq!(
        config.env.get("API_KEY").and_then(|v| v.as_str()),
        Some("secret")
    );
    assert_eq!(
        config.arguments.get("dir").and_then(|v| v.as_str()),
        Some("/tmp")
    );
}

#[test]
fn a_server_that_needs_a_value_lists_it_as_an_input() {
    let all = mcp_catalogue(String::new());
    let needing: Vec<_> = all
        .iter()
        .filter(|server| !server.inputs.is_empty())
        .collect();
    assert!(
        !needing.is_empty(),
        "some catalogue server asks for a value"
    );
    assert!(needing.iter().all(|server| {
        server
            .inputs
            .iter()
            .all(|input| !input.key.is_empty() && !input.label.is_empty())
    }));
}
