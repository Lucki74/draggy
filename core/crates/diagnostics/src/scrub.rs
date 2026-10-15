//! Secret-shaped text, secret-named fields and home-directory paths. Pure functions; the writer runs them on every line it writes.

use std::sync::LazyLock;

use regex::Regex;

use crate::text::js_len;

/// Keystore values shorter than this are not registered: they would match ordinary words.
pub(crate) const MIN_KNOWN_SECRET: usize = 6;

/// Text under this many UTF-16 units is returned as it is, as in logger.cjs.
const MIN_SCANNED_LEN: usize = 6;

/// The body of a character class for JavaScript's `\s`. The regex crate's `\s` takes U+0085 and misses U+FEFF.
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

/// `(?-u:\b)` is the ASCII word boundary JavaScript uses; `{S}` stands for `JS_SPACE`.
/// Divergence: `(?i)` also folds U+017F and U+212A to ASCII here, which JavaScript does not; a test records it.
const RULES: [(&str, &str); 10] = [
    (
        r##"(?i)(authorization["']?[{S}]*[:=][{S}]*["']?)(?:(?:Bearer|Basic|Token)[{S}]+)?[^{S}"',;]+"##,
        "${1}[secret:authorization]",
    ),
    (
        r"(?-u:\b)Bearer[{S}]+[A-Za-z0-9._~+/=-]{8,}",
        "Bearer [secret:bearer]",
    ),
    (
        r"(?-u:\b)sk-ant-[A-Za-z0-9_-]{8,}",
        "[secret:anthropic-key]",
    ),
    (r"(?-u:\b)sk-[A-Za-z0-9_-]{16,}", "[secret:sk-key]"),
    (r"(?-u:\b)AIza[0-9A-Za-z_-]{30,}", "[secret:google-key]"),
    (
        r"(?-u:\b)(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})",
        "[secret:github-token]",
    ),
    (r"(?-u:\b)hf_[A-Za-z0-9]{20,}", "[secret:hf-token]"),
    (r"(?-u:\b)xox[bp]-[A-Za-z0-9-]{10,}", "[secret:slack-token]"),
    (
        r"(?-u:\b)eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}",
        "[secret:jwt]",
    ),
    (
        r##"(?i)([?&](?:key|token|access_token|refresh_token|id_token|api_key|apikey|code|client_secret|code_verifier|signature|sig|policy|key-pair-id|x-amz-[a-z-]+|x-goog-[a-z-]+|x-xet-cas-uid)=)[^&{S}"'#]+"##,
        "${1}[secret:query]",
    ),
];

/// Field names whose value is dropped whatever it holds. Lower-case, with `-` and `_` optional in the middle.
const SECRET_KEY: &str = r"^(?:api[-_]?key|apikey|token|access[-_]?token|refresh[-_]?token|id[-_]?token|secret|client[-_]?secret|password|passwd|authorization|cookie|set-cookie|code[-_]?verifier|credentials?)$";

/// Compiled once. `None` means a pattern did not compile, and the callers fail closed.
static RULES_COMPILED: LazyLock<Option<Vec<(Regex, &'static str)>>> = LazyLock::new(|| {
    RULES
        .iter()
        .map(|(source, replacement)| {
            Regex::new(&source.replace("{S}", JS_SPACE))
                .ok()
                .map(|regex| (regex, *replacement))
        })
        .collect()
});

static SECRET_KEY_COMPILED: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(SECRET_KEY).ok());

/// Scrubs text with the fixed patterns only.
pub fn scrub_secrets(text: &str) -> String {
    scrub_with(text, &[])
}

/// Scrubs with the patterns and every registered keystore value. A pattern that fails to compile hides the whole text.
pub(crate) fn scrub_with(text: &str, known: &[String]) -> String {
    if js_len(text) < MIN_SCANNED_LEN {
        return text.to_owned();
    }
    let Some(rules) = RULES_COMPILED.as_ref() else {
        return "[secret:unavailable]".to_owned();
    };
    let mut out = text.to_owned();
    for (regex, replacement) in rules {
        out = regex.replace_all(&out, *replacement).into_owned();
    }
    for secret in known {
        if out.contains(secret.as_str()) {
            out = out.replace(secret.as_str(), "[secret:stored]");
        }
    }
    out
}

/// True for a field whose value must never be written. Only ASCII letters fold, as JavaScript's `/i` does without `u`.
/// Fails closed: with no usable pattern, every field is dropped.
pub(crate) fn is_secret_key(key: &str) -> bool {
    SECRET_KEY_COMPILED
        .as_ref()
        .is_none_or(|regex| regex.is_match(&key.to_ascii_lowercase()))
}

/// Home directory becomes `~`, and the bare user name becomes `<user>` on word boundaries. A Windows home is matched
/// with forward slashes and with the doubled backslashes a JSON-escaped path takes, as logScrub.cjs does.
pub fn scrub_paths(text: &str, home: Option<&str>, user: Option<&str>) -> String {
    let mut out = text.to_owned();
    if let Some(home) = home.filter(|home| !home.is_empty()) {
        let mut variants = vec![home.to_owned()];
        for variant in [home.replace('\\', "/"), home.replace('\\', "\\\\")] {
            if !variants.contains(&variant) {
                variants.push(variant);
            }
        }
        for variant in &variants {
            out = replace_ignoring_case(&out, variant, "~");
        }
    }
    if let Some(user) = user.filter(|user| js_len(user) >= 3) {
        out = replace_user(&out, user);
    }
    out
}

/// JavaScript's case folding for a pattern without the `u` flag: a non-ASCII letter never folds to ASCII.
fn canonical(c: char) -> char {
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(folded), None) if !(c as u32 >= 128 && (folded as u32) < 128) => folded,
        _ => c,
    }
}

/// Every case-insensitive match of `needle`, left to right and without overlap, becomes `replacement`.
fn replace_ignoring_case(text: &str, needle: &str, replacement: &str) -> String {
    let haystack: Vec<char> = text.chars().collect();
    let pattern: Vec<char> = needle.chars().map(canonical).collect();
    if pattern.is_empty() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < haystack.len() {
        let matches = index + pattern.len() <= haystack.len()
            && pattern
                .iter()
                .enumerate()
                .all(|(offset, expected)| canonical(haystack[index + offset]) == *expected);
        if matches {
            out.push_str(replacement);
            index += pattern.len();
        } else {
            out.push(haystack[index]);
            index += 1;
        }
    }
    out
}

/// The user name on word boundaries, matched without case: `(?<![A-Za-z0-9_])name(?![A-Za-z0-9_])`.
fn replace_user(text: &str, user: &str) -> String {
    let haystack: Vec<char> = text.chars().collect();
    let pattern: Vec<char> = user.chars().map(canonical).collect();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < haystack.len() {
        let end = index + pattern.len();
        let matches = !pattern.is_empty()
            && end <= haystack.len()
            && pattern
                .iter()
                .enumerate()
                .all(|(offset, expected)| canonical(haystack[index + offset]) == *expected)
            && (index == 0 || !is_word(haystack[index - 1]))
            && (end == haystack.len() || !is_word(haystack[end]));
        if matches {
            out.push_str("<user>");
            index = end;
        } else {
            out.push(haystack[index]);
            index += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        JS_SPACE, RULES, SECRET_KEY, is_secret_key, scrub_paths, scrub_secrets, scrub_with,
    };

    #[test]
    fn every_pattern_compiles() {
        for (source, _) in RULES {
            let source = source.replace("{S}", JS_SPACE);
            regex::Regex::new(&source).unwrap_or_else(|err| panic!("{source}: {err}"));
        }
        regex::Regex::new(SECRET_KEY).unwrap_or_else(|err| panic!("secret key: {err}"));
    }

    #[test]
    fn scrubs_a_key_and_keeps_the_text_around_it() {
        assert_eq!(
            scrub_secrets("x sk-ant-api03-ABCDEFGH end"),
            "x [secret:anthropic-key] end"
        );
    }

    #[test]
    fn leaves_short_text_and_word_interior_matches_alone() {
        assert_eq!(scrub_secrets("sk-abc"), "sk-abc");
        assert_eq!(
            scrub_secrets("risksk-abcdefghijklmnopqrstu"),
            "risksk-abcdefghijklmnopqrstu"
        );
    }

    #[test]
    fn registered_values_are_dropped_wherever_they_appear() {
        let known = ["plain-looking-value".to_owned()];
        assert_eq!(
            scrub_with("token plain-looking-value here", &known),
            "token [secret:stored] here"
        );
    }

    #[test]
    fn secret_named_fields_are_detected_in_any_case_and_spelling() {
        for key in [
            "apiKey",
            "api_key",
            "API-KEY",
            "access_token",
            "set-cookie",
            "code_verifier",
            "credentials",
        ] {
            assert!(is_secret_key(key), "{key}");
        }
        for key in ["code", "model", "tokenCount", "path"] {
            assert!(!is_secret_key(key), "{key}");
        }
    }

    #[test]
    fn key_names_fold_only_ascii_letters() {
        assert!(!is_secret_key("\u{017F}ecret"));
        assert!(!is_secret_key("accessTo\u{212A}en"));
    }

    #[test]
    fn whitespace_before_a_bearer_token_follows_javascript_s_space_class() {
        assert_eq!(
            scrub_secrets("Bearer\u{FEFF}abcdefgh12345678"),
            "Bearer [secret:bearer]"
        );
        assert_eq!(
            scrub_secrets("Bearer\u{0085}abcdefgh12345678"),
            "Bearer\u{0085}abcdefgh12345678"
        );
    }

    #[test]
    fn a_long_s_is_matched_by_the_key_name_where_javascript_does_not_fold_it() {
        // Divergence: JavaScript leaves `ſig` alone, Rust folds it to `sig` and scrubs it. Over-matching is the safe side.
        assert_eq!(
            scrub_secrets("https://x.test/a?ſig=abcdefghijk"),
            "https://x.test/a?ſig=[secret:query]"
        );
    }

    #[test]
    fn home_and_user_are_replaced_in_every_separator_style() {
        let home = ["C:", "Users", "jdoe"].join("\\");
        let text = format!(
            "{home}\\x C:/Users/jdoe/y {{\"p\":\"{}\"}}",
            home.replace('\\', "\\\\")
        );
        assert_eq!(
            scrub_paths(&text, Some(&home), Some("jdoe")),
            "~\\x ~/y {\"p\":\"~\"}"
        );
        assert_eq!(
            scrub_paths("owner jdoe jdoeson", None, Some("jdoe")),
            "owner <user> jdoeson"
        );
        assert_eq!(scrub_paths("me and my", None, Some("me")), "me and my");
    }
}
