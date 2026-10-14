//! The names the client gives a server and its tools, as the reference builds them.

/// The most characters of a server id that make it into a log scope.
const SCOPE_ID_UNITS: usize = 32;

/// A qualified tool name taken apart again: the server it came from and the tool's own name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitName {
    pub server_id: String,
    pub tool_name: String,
}

/// The log scope for one server: `mcp.<id>`, lowercased and cut to `[a-z0-9_-]`, so one filter finds all of its lines.
/// Each UTF-16 unit is replaced on its own, as the reference counts them.
pub fn scope_for(id: &str) -> String {
    let clean: String = id
        .to_lowercase()
        .encode_utf16()
        .take(SCOPE_ID_UNITS)
        .map(|unit| match u8::try_from(unit) {
            Ok(byte)
                if byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || byte == b'_'
                    || byte == b'-' =>
            {
                char::from(byte)
            }
            _ => '-',
        })
        .collect();

    if clean.is_empty() {
        "mcp.server".to_owned()
    } else {
        format!("mcp.{clean}")
    }
}

/// `server__tool`, so two servers can both offer `search`. Each UTF-16 unit that a tool name cannot hold becomes `_`.
// TS quirk: two different names can clean to the same qualified name, and nothing here tells them apart.
pub fn qualified_name(server_id: &str, tool_name: &str) -> String {
    format!("{}__{}", clean_name(server_id), clean_name(tool_name))
}

/// Splits at the first `__`, so a tool whose own name holds `__` keeps it.
pub fn split_qualified_name(name: &str) -> Option<SplitName> {
    let index = name.find("__")?;
    Some(SplitName {
        server_id: name[..index].to_owned(),
        tool_name: name[index + 2..].to_owned(),
    })
}

fn clean_name(text: &str) -> String {
    text.encode_utf16()
        .map(|unit| match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() || byte == b'_' => char::from(byte),
            _ => '_',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_lowercases_and_cleans_the_id() {
        assert_eq!(scope_for("Acme.Tools 2"), "mcp.acme-tools-2");
    }

    #[test]
    fn scope_is_cut_to_32_units() {
        assert_eq!(
            scope_for(&"x".repeat(40)),
            format!("mcp.{}", "x".repeat(32))
        );
    }

    #[test]
    fn scope_counts_an_astral_character_as_two_units() {
        // The reference replaces each UTF-16 unit, so one emoji becomes two dashes.
        assert_eq!(scope_for("a\u{1F600}b"), "mcp.a--b");
    }

    #[test]
    fn empty_id_uses_the_fallback_scope() {
        assert_eq!(scope_for(""), "mcp.server");
    }

    #[test]
    fn qualified_name_counts_an_astral_character_as_two_underscores() {
        assert_eq!(qualified_name("s", "a\u{1F600}"), "s__a__");
    }
}
