//! What the agent may act on: fields that are the user's to fill, clicks that look like payments or
//! sends, how fast it may act, and which sites it may act on. No site is approved until consent lands.

use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::Value;

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
    if field("type").eq_ignore_ascii_case("password") {
        return Some("a password field");
    }
    if SENSITIVE_AUTOCOMPLETE.is_match(field("autocomplete")) {
        return Some("a card, password or one-time code field");
    }
    let named = ["name", "id", "placeholder", "label"]
        .iter()
        .any(|key| SENSITIVE_NAME.is_match(field(key)));
    named.then_some("a field for a card, ID, password or token")
}

/// Why a click or submit needs the user's word, or None for an ordinary one.
pub fn risky_action(role: &str, name: &str, input_type: &str) -> Option<String> {
    if input_type == "submit" {
        return Some("submits a form".to_owned());
    }
    if !CLICKABLE.contains(&role) {
        return None;
    }
    if RISKY_LATIN.is_match(name) || RISKY_CJK.is_match(name) {
        let shown: String = name.chars().take(40).collect();
        return Some(format!(
            "looks like it pays, deletes, sends or posts (\"{shown}\")"
        ));
    }
    None
}

/// Whether the agent may act on the page at `url`. No site has been approved yet, so none is.
pub fn site_allowed(_url: &str) -> bool {
    false
}

/// At most `max` actions in any `window`.
pub struct RateLimit {
    max: usize,
    window: Duration,
    taken: Mutex<VecDeque<Instant>>,
}

impl RateLimit {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            taken: Mutex::new(VecDeque::new()),
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
            return false;
        }
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
    fn no_site_is_approved_yet() {
        assert!(!site_allowed("https://example.com/"));
    }
}
