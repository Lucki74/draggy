use super::ad_block_rules::default_blocked_domains;

pub struct AdBlocker {
    blocked: Vec<&'static str>,
}

impl Default for AdBlocker {
    fn default() -> Self {
        Self {
            blocked: default_blocked_domains(),
        }
    }
}

impl AdBlocker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_blocked(&self, url: &str) -> bool {
        for domain in &self.blocked {
            if url.contains(domain) {
                return true;
            }
        }
        false
    }
}
