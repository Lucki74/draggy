//! The ad and tracker rules both native browsers load. `shared/adblock/hosts.txt` is the one list; this turns it into
//! the JSON WebKit content blockers read, which macOS (`WKContentRuleList`) and Linux (`WebKitUserContentFilter`) share.

const HOSTS: &str = include_str!("../../../../shared/adblock/hosts.txt");

/// The hosts in the list, without comments or blank lines.
fn hosts(list: &str) -> Vec<&str> {
    list.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).collect()
}

fn escape(host: &str) -> String {
    host.replace('.', r"\\.")
}

fn rules(list: &str) -> String {
    let entries: Vec<String> = hosts(list)
        .into_iter()
        .map(|host| {
            format!(
                "{{\"trigger\":{{\"url-filter\":\"^[a-z]+://([^/]*\\\\.)?{}[:/]\",\"load-type\":[\"third-party\"]}},\"action\":{{\"type\":\"block\"}}}}",
                escape(host)
            )
        })
        .collect();
    format!("[{}]", entries.join(","))
}

/// The content-blocker rules, as one JSON array, that stop third-party loads from the listed hosts.
#[uniffi::export]
pub fn adblock_rules() -> String {
    rules(HOSTS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_and_blank_lines_are_not_hosts() {
        assert_eq!(hosts("# note\n\n a.com \nb.org\n"), vec!["a.com", "b.org"]);
    }

    #[test]
    fn the_rules_are_json_with_one_block_rule_per_host() {
        let value: serde_json::Value = serde_json::from_str(&adblock_rules()).unwrap();
        let rules = value.as_array().unwrap();
        assert_eq!(rules.len(), hosts(HOSTS).len());
        assert!(rules.len() > 20);
        assert_eq!(rules[0]["action"]["type"], "block");
    }

    #[test]
    fn a_rule_matches_the_host_and_its_subdomains_only() {
        let value: serde_json::Value = serde_json::from_str(&rules("ads.example.com\n")).unwrap();
        let filter = value[0]["trigger"]["url-filter"].as_str().unwrap();
        assert_eq!(filter, r"^[a-z]+://([^/]*\.)?ads\.example\.com[:/]");
    }
}
