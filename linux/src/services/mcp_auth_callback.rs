pub struct McpAuthCallback;

impl McpAuthCallback {
    pub fn extract_code(query_str: &str) -> Option<String> {
        for pair in query_str.split('&') {
            let mut parts = pair.split('=');
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                if k == "code" {
                    return Some(v.to_string());
                }
            }
        }
        None
    }
}
