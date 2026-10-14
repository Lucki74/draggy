//! The catalogue rules the TypeScript catalogue tests assert, checked against the data the crate loads.

use std::collections::HashSet;

use draggy_mcp::catalogue::{catalogue, find_entry, list_catalogue, search_catalogue};

fn ids() -> Vec<String> {
    catalogue().iter().map(|entry| entry.id.clone()).collect()
}

#[test]
fn offers_at_least_one_hundred_servers() {
    assert!(
        catalogue().len() >= 100,
        "only {} servers",
        catalogue().len()
    );
}

#[test]
fn gives_every_server_a_unique_id() {
    let ids = ids();
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
}

#[test]
fn does_not_offer_a_provider_the_app_already_has() {
    // Brave, DuckDuckGo and the browser are built in, so a second way to reach them is a choice the model can get wrong.
    for id in ids() {
        for built_in in [
            "brave",
            "duckduckgo",
            "puppeteer",
            "playwright",
            "browserbase",
        ] {
            assert!(
                !id.starts_with(built_in),
                "{id} duplicates a built-in feature"
            );
        }
    }
}

#[test]
fn still_offers_the_search_services_the_app_cannot_do_itself() {
    let ids = ids();
    for id in ["perplexity", "exa", "tavily", "firecrawl"] {
        assert!(ids.iter().any(|one| one == id), "{id} should be offered");
    }
}

#[test]
fn does_not_offer_extensions_that_duplicate_built_in_features() {
    let ids = ids();
    for id in ["filesystem", "sequential-thinking", "everything"] {
        assert!(
            !ids.iter().any(|one| one == id),
            "{id} duplicates a built-in feature"
        );
    }
}

#[test]
fn includes_verified_developer_and_database_servers() {
    let ids = ids();
    for id in [
        "azure-devops",
        "netlify",
        "mysql",
        "sqlite",
        "pinecone",
        "jira",
        "confluence",
        "asana",
        "clickup",
        "google-calendar",
        "hubspot",
        "datadog",
        "shopify",
        "contentful",
        "composio",
    ] {
        assert!(ids.iter().any(|one| one == id), "{id} is missing");
    }
}

#[test]
fn links_every_server_to_its_package_documentation() {
    for entry in list_catalogue() {
        let package = entry.package.clone().unwrap_or_default();
        assert_eq!(
            entry.docs.as_deref(),
            Some(format!("https://www.npmjs.com/package/{package}").as_str()),
            "{}",
            entry.id
        );
    }
}

#[test]
fn links_every_service_it_names_over_https() {
    for entry in catalogue() {
        if let Some(site) = &entry.site {
            assert!(site.starts_with("https://"), "{}", entry.id);
        }
    }
}

#[test]
fn gives_every_server_except_memory_a_website() {
    for entry in catalogue() {
        if entry.id != "memory" {
            assert!(
                entry.site.as_deref().is_some_and(|site| !site.is_empty()),
                "{} has no website",
                entry.id
            );
        }
    }
}

#[test]
fn names_a_package_with_no_whitespace_for_every_server() {
    for entry in catalogue() {
        let package = entry.package.clone().unwrap_or_default();
        assert!(!package.is_empty(), "{}", entry.id);
        assert!(!package.chars().any(char::is_whitespace), "{}", entry.id);
    }
}

#[test]
fn describes_every_server_in_a_sentence() {
    for entry in catalogue() {
        assert!(
            entry.name.as_deref().is_some_and(|name| !name.is_empty()),
            "{}",
            entry.id
        );
        assert!(entry.description.chars().count() > 20, "{}", entry.id);
    }
}

#[test]
fn gives_every_credential_a_label_and_an_env_style_key() {
    for entry in catalogue() {
        for variable in entry.env.iter().flatten() {
            assert!(
                !variable.key.is_empty()
                    && variable
                        .key
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'),
                "{}.{}",
                entry.id,
                variable.key
            );
            assert!(
                variable
                    .label
                    .as_deref()
                    .is_some_and(|label| !label.is_empty()),
                "{}.{}",
                entry.id,
                variable.key
            );
        }
    }
}

#[test]
fn finds_a_server_by_id_and_nothing_for_an_unknown_one() {
    assert_eq!(
        find_entry("github").and_then(|entry| entry.name).as_deref(),
        Some("GitHub")
    );
    assert!(find_entry("nope").is_none());
}

#[test]
fn matches_a_search_on_name_and_ignores_case() {
    assert!(
        search_catalogue("github")
            .iter()
            .any(|entry| entry.id == "github")
    );
    assert!(
        search_catalogue("SLACK")
            .iter()
            .any(|entry| entry.id == "slack")
    );
    assert_eq!(search_catalogue("").len(), list_catalogue().len());
}
