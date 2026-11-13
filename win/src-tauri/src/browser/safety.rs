//! What the agent may act on: fields that are the user's to fill, clicks that look like payments or
//! sends, how fast it may act, and which sites it may act on. No site is approved until consent lands.
//! Decisions are logged as categories and hosts only, never labels or values.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::Value;
use tauri::Url;

const SCOPE: &str = "browser.safety";
const CLICKABLE: &[&str] = &[
    "button", "link", "menuitem", "checkbox", "switch", "tab", "option",
];

static SENSITIVE_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|[^a-z])(card|cvv|cvc|iban|ssn|passport|token|secret|api[-_ ]?key|otp|passcode|pin|password|passwd)s?([^a-z]|$)")
        .expect("valid pattern")
});
static SENSITIVE_AUTOCOMPLETE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(cc-|one-time-code|current-password|new-password)").expect("valid pattern")
});
static RISKY_LATIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(pay|payer|pagar|buy|acheter|comprar|purchase|order|commander|pedir|checkout|delete|supprimer|eliminar|borrar|remove|send|envoyer|enviar|post|publish|publier|publicar|submit|soumettre|subscribe|donate|confirm)\b")
        .expect("valid pattern")
});
static RISKY_CJK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(оплат|купить|заказ|удал|отправ|опублик|подать|подписа|пожертв|подтверд)")
        .expect("valid pattern")
});

/// Why a field is the user's to fill in, or None. `attrs` is what the page says about the field.
pub fn sensitive_field(attrs: &Value) -> Option<&'static str> {
    let field = |key: &str| attrs.get(key).and_then(Value::as_str).unwrap_or_default();
    let (rule, message) = if field("type").eq_ignore_ascii_case("password") {
        ("password", "a password field")
    } else if SENSITIVE_AUTOCOMPLETE.is_match(field("autocomplete")) {
        ("autocomplete", "a card, password or one-time code field")
    } else if ["name", "id", "placeholder", "label"]
        .iter()
        .any(|key| SENSITIVE_NAME.is_match(field(key)))
    {
        ("attr-name", "a field for a card, ID, password or token")
    } else {
        return None;
    };
    tracing::debug!(target: SCOPE, rule, "field left to user");
    Some(message)
}

/// Why a click or submit needs the user's word, or None for an ordinary one.
pub fn risky_action(role: &str, name: &str, input_type: &str) -> Option<String> {
    if input_type == "submit" {
        tracing::debug!(target: SCOPE, category = "form-submit", role, "click needs user word");
        return Some("submits a form".to_owned());
    }
    if !CLICKABLE.contains(&role) {
        return None;
    }
    if RISKY_LATIN.is_match(name) || RISKY_CJK.is_match(name) {
        tracing::debug!(target: SCOPE, category = "pays-deletes-sends-posts", role, "click needs user word");
        let shown: String = name.chars().take(40).collect();
        return Some(format!(
            "looks like it pays, deletes, sends or posts (\"{shown}\")"
        ));
    }
    None
}

/// The origin of an http or https address, as the page reports it, or None for anything else.
pub fn origin_of(url: &str) -> Option<String> {
    let parsed = match Url::parse(url) {
        Ok(parsed) => parsed,
        Err(error) => {
            tracing::debug!(target: SCOPE, error = %error, "swallowed: not a web address");
            return None;
        }
    };
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.origin().ascii_serialization())
}

/// The host of an address alone: what the logs may keep of it.
pub fn host_of(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) => parsed.host_str().map(str::to_owned).unwrap_or_default(),
        Err(error) => {
            tracing::debug!(target: SCOPE, error = %error, "swallowed: not a web address, host left blank");
            String::new()
        }
    }
}

/// What the user let the agent do on which sites. A trusted site is saved; a session grant is not.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Grants {
    trusted: Vec<String>,
    session: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Standing {
    Trusted,
    Session,
    Unknown,
}

impl Grants {
    pub fn new(trusted: Vec<String>) -> Self {
        let mut grants = Self::default();
        for origin in trusted {
            push_unique(&mut grants.trusted, origin);
        }
        grants
    }

    pub fn standing(&self, origin: &str) -> Standing {
        if self.trusted.iter().any(|o| o == origin) {
            Standing::Trusted
        } else if self.session.iter().any(|o| o == origin) {
            Standing::Session
        } else {
            Standing::Unknown
        }
    }

    pub fn allow_session(&mut self, origin: &str) {
        push_unique(&mut self.session, origin.to_owned());
        tracing::info!(target: SCOPE, host = %host_of(origin), "site allowed for session");
    }

    pub fn trust(&mut self, origin: &str) {
        push_unique(&mut self.trusted, origin.to_owned());
        self.session.retain(|o| o != origin);
        tracing::info!(target: SCOPE, host = %host_of(origin), "site trusted");
    }

    pub fn revoke(&mut self, origin: &str) {
        let was_trusted = self.trusted.iter().any(|o| o == origin);
        self.trusted.retain(|o| o != origin);
        self.session.retain(|o| o != origin);
        tracing::info!(target: SCOPE, host = %host_of(origin), was_trusted, "site revoked");
    }

    pub fn list(&self) -> &[String] {
        &self.trusted
    }
}

fn push_unique(list: &mut Vec<String>, origin: String) {
    if !list.contains(&origin) {
        list.push(origin);
    }
}

/// The saved trusted sites: a JSON array of origins. Anything else reads as none.
pub fn parse_trusted(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|text| serde_json::from_str::<Vec<Value>>(text).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect()
}

/// At most `max` actions in any `window`.
pub struct RateLimit {
    max: usize,
    window: Duration,
    taken: Mutex<VecDeque<Instant>>,
    refusing: AtomicBool,
}

impl RateLimit {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            taken: Mutex::new(VecDeque::new()),
            refusing: AtomicBool::new(false),
        }
    }

    /// Takes one action from the budget, or returns false when the window is full.
    pub fn take(&self) -> bool {
        let now = Instant::now();
        let mut taken = self.taken.lock().unwrap_or_else(PoisonError::into_inner);
        while taken
            .front()
            .is_some_and(|at| now.duration_since(*at) >= self.window)
        {
            taken.pop_front();
        }
        if taken.len() >= self.max {
            // One WARN when the window fills, not one per refused action.
            if !self.refusing.swap(true, Ordering::Relaxed) {
                tracing::warn!(target: SCOPE, max = self.max, "rate limit reached");
            }
            return false;
        }
        self.refusing.store(false, Ordering::Relaxed);
        taken.push_back(now);
        true
    }
}

impl Default for RateLimit {
    fn default() -> Self {
        Self::new(60, Duration::from_secs(60))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn card_and_password_fields_are_the_users() {
        assert!(sensitive_field(&json!({"type": "text", "name": "card_number"})).is_some());
        assert!(sensitive_field(&json!({"type": "password"})).is_some());
        assert!(sensitive_field(&json!({"autocomplete": "cc-number"})).is_some());
        assert!(sensitive_field(&json!({"type": "text", "name": "username"})).is_none());
    }

    #[test]
    fn payment_and_send_buttons_need_confirmation() {
        assert!(risky_action("button", "Pay now", "").is_some());
        assert!(risky_action("link", "Delete account", "").is_some());
        assert!(risky_action("textbox", "Pay", "").is_none());
        assert!(risky_action("button", "Save", "").is_none());
        assert!(risky_action("textbox", "", "submit").is_some());
    }

    #[test]
    fn rate_limit_stops_at_the_budget() {
        let limit = RateLimit::new(2, Duration::from_secs(60));
        assert!(limit.take());
        assert!(limit.take());
        assert!(!limit.take());
    }

    #[test]
    fn a_new_site_is_unknown_until_granted() {
        let mut grants = Grants::new(vec!["https://a.test".to_owned()]);
        assert_eq!(grants.standing("https://a.test"), Standing::Trusted);
        assert_eq!(grants.standing("https://b.test"), Standing::Unknown);
        grants.allow_session("https://b.test");
        assert_eq!(grants.standing("https://b.test"), Standing::Session);
        grants.trust("https://b.test");
        assert_eq!(grants.list(), ["https://a.test", "https://b.test"]);
        grants.revoke("https://a.test");
        assert_eq!(grants.standing("https://a.test"), Standing::Unknown);
    }

    #[test]
    fn origins_and_hosts_drop_paths_and_queries() {
        assert_eq!(
            origin_of("https://a.test:8443/x?token=1").as_deref(),
            Some("https://a.test:8443")
        );
        assert_eq!(origin_of("about:blank"), None);
        assert_eq!(host_of("https://a.test/x?q=1"), "a.test");
    }

    #[test]
    fn saved_sites_must_be_a_list_of_strings() {
        assert_eq!(
            parse_trusted(Some(r#"["https://a.test", 3]"#)),
            ["https://a.test"]
        );
        assert!(parse_trusted(Some("not json")).is_empty());
        assert!(parse_trusted(None).is_empty());
    }
}
