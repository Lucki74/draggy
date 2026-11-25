//! Key specs for the browser pane, such as "Control+A", "Enter" or "F5", parsed as browserInput.cjs does.

use std::fmt;

const NAMED_KEYS: &[(&str, &str)] = &[
    ("enter", "Return"),
    ("return", "Return"),
    ("tab", "Tab"),
    ("escape", "Escape"),
    ("esc", "Escape"),
    ("backspace", "Backspace"),
    ("delete", "Delete"),
    ("space", " "),
    ("insert", "Insert"),
    ("up", "Up"),
    ("arrowup", "Up"),
    ("down", "Down"),
    ("arrowdown", "Down"),
    ("left", "Left"),
    ("arrowleft", "Left"),
    ("right", "Right"),
    ("arrowright", "Right"),
    ("home", "Home"),
    ("end", "End"),
    ("pageup", "PageUp"),
    ("pagedown", "PageDown"),
];

/// Modifier names as the CDP `Input` domain spells them.
const MODIFIERS: &[(&str, &str)] = &[
    ("control", "control"),
    ("ctrl", "control"),
    ("shift", "shift"),
    ("alt", "alt"),
    ("option", "alt"),
    ("meta", "meta"),
    ("cmd", "meta"),
    ("command", "meta"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyError {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedKey {
    pub key_code: String,
    pub modifiers: Vec<&'static str>,
    pub char: Option<String>,
}

fn modifier(name: &str) -> Option<&'static str> {
    let lower = name.trim().to_lowercase();
    MODIFIERS.iter().find(|(k, _)| *k == lower).map(|(_, v)| *v)
}

/// Modifier list from a call's options; a bad name is an `invalid_input` error.
pub fn modifiers_of(names: &[&str]) -> Result<Vec<&'static str>, KeyError> {
    names
        .iter()
        .map(|name| {
            modifier(name).ok_or_else(|| KeyError {
                code: "invalid_input",
                message: format!("\"{name}\" is not a modifier key."),
            })
        })
        .collect()
}

/// The key and the modifiers held with it. A trailing `+` names the plus key.
pub fn parse_key(spec: &str) -> Result<ParsedKey, KeyError> {
    let text = spec.trim();
    if text.is_empty() {
        return Err(KeyError {
            code: "invalid_key",
            message: "No key was given.".to_owned(),
        });
    }
    let mut parts: Vec<&str> = if text.chars().count() > 1 && text.ends_with('+') {
        let mut head: Vec<&str> = text[..text.len() - 2].split('+').collect();
        head.push("+");
        head
    } else {
        text.split('+').collect()
    };
    let key_part = parts.pop().unwrap_or_default().trim();
    let mut modifiers = Vec::new();
    for name in parts.into_iter().filter(|p| !p.is_empty()) {
        let known = modifier(name).ok_or_else(|| KeyError {
            code: "invalid_key",
            message: format!("\"{name}\" is not a modifier key."),
        })?;
        modifiers.push(known);
    }
    let lower = key_part.to_lowercase();
    if let Some((_, code)) = NAMED_KEYS.iter().find(|(k, _)| *k == lower) {
        let char = (lower == "space").then(|| " ".to_owned());
        return Ok(ParsedKey {
            key_code: (*code).to_owned(),
            modifiers,
            char,
        });
    }
    if is_function_key(&lower) {
        return Ok(ParsedKey {
            key_code: lower.to_uppercase(),
            modifiers,
            char: None,
        });
    }
    if key_part.chars().count() == 1 {
        return Ok(ParsedKey {
            key_code: key_part.to_owned(),
            modifiers,
            char: Some(key_part.to_owned()),
        });
    }
    Err(KeyError {
        code: "invalid_key",
        message: format!("\"{key_part}\" is not a key Draggy knows."),
    })
}

/// F1 to F12 only.
fn is_function_key(lower: &str) -> bool {
    lower
        .strip_prefix('f')
        .filter(|n| !n.starts_with('0') && n.len() <= 2)
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_keys_map_to_cdp_names() {
        assert_eq!(parse_key("Enter").unwrap().key_code, "Return");
        assert_eq!(parse_key("ArrowDown").unwrap().key_code, "Down");
        assert_eq!(parse_key("PageUp").unwrap().key_code, "PageUp");
    }

    #[test]
    fn space_is_a_character() {
        let key = parse_key("space").unwrap();
        assert_eq!(key.key_code, " ");
        assert_eq!(key.char.as_deref(), Some(" "));
    }

    #[test]
    fn modifiers_are_collected_and_aliased() {
        let key = parse_key("Ctrl+Cmd+A").unwrap();
        assert_eq!(key.key_code, "A");
        assert_eq!(key.modifiers, vec!["control", "meta"]);
        assert_eq!(key.char.as_deref(), Some("A"));
    }

    #[test]
    fn trailing_plus_is_the_plus_key() {
        let key = parse_key("Control++").unwrap();
        assert_eq!(key.key_code, "+");
        assert_eq!(key.modifiers, vec!["control"]);
    }

    #[test]
    fn function_keys_are_upper_cased() {
        let key = parse_key("f12").unwrap();
        assert_eq!(key.key_code, "F12");
        assert!(key.char.is_none());
        assert!(parse_key("F13").is_err());
        assert!(parse_key("F0").is_err());
    }

    #[test]
    fn bad_specs_are_refused() {
        assert_eq!(parse_key("  ").unwrap_err().message, "No key was given.");
        assert_eq!(
            parse_key("Hyper+A").unwrap_err().message,
            "\"Hyper\" is not a modifier key."
        );
        let unknown = parse_key("Launch").unwrap_err();
        assert_eq!(unknown.code, "invalid_key");
        assert_eq!(unknown.message, "\"Launch\" is not a key Draggy knows.");
    }

    #[test]
    fn modifier_lists_reject_unknown_names() {
        assert_eq!(
            modifiers_of(&["Shift", "option"]).unwrap(),
            vec!["shift", "alt"]
        );
        let error = modifiers_of(&["super"]).unwrap_err();
        assert_eq!(error.code, "invalid_input");
        assert_eq!(error.message, "\"super\" is not a modifier key.");
    }
}
