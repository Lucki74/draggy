//! Split-model file names, `model-00001-of-00004.gguf`, which llama.cpp loads from its first part.
//! Port of electron/shards.cjs.

use tracing::debug;

/// The position of one part of a split model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shard {
    pub stem: String,
    pub index: u32,
    pub total: u32,
    /// The total as written, five digits with any leading zeros, so names come out the same.
    pub total_text: String,
}

/// The last path component, read the way Node's `path.basename` reads a POSIX path.
pub fn basename(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(at) => &trimmed[at + 1..],
        None => trimmed,
    }
}

/// `text` without `suffix` when it ends with it, ignoring ASCII case.
pub(crate) fn strip_suffix_ci<'a>(text: &'a str, suffix: &str) -> Option<&'a str> {
    let split = text.len().checked_sub(suffix.len())?;
    let tail = text.get(split..)?;
    if !tail.eq_ignore_ascii_case(suffix) {
        return None;
    }
    text.get(..split)
}

/// Reads `<stem>-DDDDD-of-DDDDD.gguf` from the basename. The `of` and the extension ignore case, as the reference's `/i` does.
pub fn parse_shard(filename: &str) -> Option<Shard> {
    let body = strip_suffix_ci(basename(filename), ".gguf")?;
    // The tail is fixed width, so the stem is everything before it and the match is unique.
    let split = body.len().checked_sub(15)?;
    let stem = body.get(..split)?;
    let rest = body.get(split..)?.strip_prefix('-')?;
    let index = digits5(rest.get(..5)?)?;
    if !rest.get(5..9)?.eq_ignore_ascii_case("-of-") {
        return None;
    }
    let total_text = rest.get(9..14)?;
    let total = digits5(total_text)?;
    // `.+` in the reference cannot cross a line terminator.
    if stem.is_empty() || stem.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some(Shard {
        stem: stem.to_owned(),
        index,
        total,
        total_text: total_text.to_owned(),
    })
}

fn digits5(text: &str) -> Option<u32> {
    if text.len() == 5 && text.bytes().all(|byte| byte.is_ascii_digit()) {
        text.parse().ok()
    } else {
        None
    }
}

/// Every file a split model is made of, in order; the one basename for a single-file model.
pub fn shard_names(filename: &str) -> Vec<String> {
    let Some(shard) = parse_shard(filename) else {
        return vec![basename(filename).to_owned()];
    };
    debug!(target: "engine.shards", parts = shard.total, "split model listed");
    (1..=shard.total)
        .map(|position| format!("{}-{position:05}-of-{}.gguf", shard.stem, shard.total_text))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_drops_directories_and_trailing_slashes() {
        assert_eq!(basename("/a/b/c.gguf"), "c.gguf");
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(basename("/"), "");
        assert_eq!(basename(""), "");
    }

    #[test]
    fn a_stem_of_one_character_is_still_a_shard() {
        let shard = parse_shard("x-00001-of-00002.gguf").expect("shard");
        assert_eq!(shard.stem, "x");
    }

    #[test]
    fn a_fifteen_byte_name_has_no_stem() {
        assert!(parse_shard("-00001-of-00002.gguf").is_none());
    }
}
