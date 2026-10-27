pub struct McpAuthCallback;

impl McpAuthCallback {
    pub fn extract_code(query_str: &str) -> Option<String> {
        query_str.split('&').find_map(|pair| {
            let mut parts = pair.split('=');
            match (parts.next(), parts.next()) {
                (Some("code"), Some(v)) => Some(v.to_string()),
                _ => None,
            }
        })
    }
}
