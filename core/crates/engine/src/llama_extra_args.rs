//! Extra llama-server arguments a user typed: split like a shell line, then stripped of the flags Draggy owns.
//!
//! The result is passed as separate argv entries and never reaches a shell.

/// Longest line read, in bytes.
pub const EXTRA_ARGS_LIMIT: usize = 4 * 1024;

/// Flags Draggy sets itself or must not hand over, with whether each takes a value.
const DENIED: &[(&str, bool)] = &[
    ("--host", true),
    ("--port", true),
    ("--api-key", true),
    ("--api-key-file", true),
    ("-m", true),
    ("--model", true),
    ("--embedding", false),
    ("--embeddings", false),
    ("--path", true),
    ("--ssl-key-file", true),
    ("--ssl-cert-file", true),
    ("-c", true),
    ("--ctx-size", true),
    ("-ngl", true),
    ("--n-gpu-layers", true),
    ("--gpu-layers", true),
    ("-t", true),
    ("--threads", true),
    ("-tb", true),
    ("--threads-batch", true),
    ("-np", true),
    ("--parallel", true),
    ("-ctk", true),
    ("--cache-type-k", true),
    ("-ctv", true),
    ("--cache-type-v", true),
    ("-md", true),
    ("--model-draft", true),
    ("--mmproj", true),
    ("-mm", true),
    ("-hf", true),
    ("--hf-repo", true),
    ("--hf-file", true),
    ("--hf-token", true),
    ("-mu", true),
    ("--model-url", true),
    ("--rpc", true),
];

/// The arguments to append, and the flags that were left out.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Sanitized {
    pub args: Vec<String>,
    pub dropped: Vec<String>,
}

/// Splits `line` as a shell would. Single quotes are literal, double quotes allow `\"` and `\\`, and any other
/// backslash stays, so Windows paths survive. An open quote ends with the line.
pub fn split_args(line: &str) -> Vec<String> {
    let line = cap(line);
    let mut out = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                started = true;
                for q in chars.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    current.push(q);
                }
            }
            '"' => {
                started = true;
                while let Some(q) = chars.next() {
                    match q {
                        '"' => break,
                        '\\' if matches!(chars.peek(), Some('"' | '\\')) => {
                            current.extend(chars.next());
                        }
                        _ => current.push(q),
                    }
                }
            }
            c if c.is_whitespace() => {
                if started {
                    out.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            _ => {
                started = true;
                current.push(c);
            }
        }
    }
    if started {
        out.push(current);
    }
    out
}

fn cap(line: &str) -> &str {
    if line.len() <= EXTRA_ARGS_LIMIT {
        return line;
    }
    let mut end = EXTRA_ARGS_LIMIT;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    &line[..end]
}

/// Splits `line` and drops every denied flag with its value, in both `--flag value` and `--flag=value` forms.
pub fn sanitize(line: &str) -> Sanitized {
    let tokens = split_args(line);
    let mut result = Sanitized::default();
    let mut skip_value = false;
    for token in tokens {
        if skip_value {
            skip_value = false;
            if !token.starts_with('-') {
                continue;
            }
        }
        if token.starts_with('-') {
            let (name, inline) = match token.split_once('=') {
                Some((name, _)) => (name, true),
                None => (token.as_str(), false),
            };
            if let Some((_, takes_value)) = DENIED.iter().find(|(flag, _)| *flag == name) {
                result.dropped.push(name.to_owned());
                skip_value = *takes_value && !inline;
                continue;
            }
        }
        result.args.push(token);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(line: &str) -> Vec<String> {
        split_args(line)
    }

    #[test]
    fn splits_on_white_space() {
        assert_eq!(words("  -fa   on\t--no-mmap\n"), ["-fa", "on", "--no-mmap"]);
        assert!(words("   ").is_empty());
    }

    #[test]
    fn quotes_group_words() {
        assert_eq!(
            words(r#"--chat-template "a b" 'c d'"#),
            ["--chat-template", "a b", "c d"]
        );
        assert_eq!(words(r#"--x "say \"hi\"""#), ["--x", r#"say "hi""#]);
        assert_eq!(words(r#"a"b c"d"#), ["ab cd"]);
        assert_eq!(words("--x ''"), ["--x", ""]);
    }

    #[test]
    fn backslashes_stay_for_paths() {
        assert_eq!(
            words(r"--lora C:\models\a.gguf"),
            ["--lora", r"C:\models\a.gguf"]
        );
        assert_eq!(
            words(r#"--lora "C:\my models\a.gguf""#),
            ["--lora", r"C:\my models\a.gguf"]
        );
    }

    #[test]
    fn an_open_quote_ends_with_the_line() {
        assert_eq!(words(r#"--x "open end"#), ["--x", "open end"]);
    }

    #[test]
    fn shell_syntax_is_plain_text() {
        assert_eq!(
            words("-a ; rm -rf $HOME | cat"),
            ["-a", ";", "rm", "-rf", "$HOME", "|", "cat"]
        );
    }

    #[test]
    fn the_line_is_capped() {
        let line = "é ".repeat(EXTRA_ARGS_LIMIT);
        assert!(words(&line).len() <= EXTRA_ARGS_LIMIT / 3 + 1);
    }

    #[test]
    fn owned_flags_are_dropped_with_their_values() {
        let out = sanitize(
            "--host 0.0.0.0 -fa on --port=9 --api-key x -m other.gguf --embedding --no-mmap",
        );
        assert_eq!(out.args, ["-fa", "on", "--no-mmap"]);
        assert_eq!(
            out.dropped,
            ["--host", "--port", "--api-key", "-m", "--embedding"]
        );
    }

    #[test]
    fn draggy_sized_flags_are_dropped() {
        let out = sanitize(
            "-c 4096 -ngl 99 --threads 4 -np 8 -ctk q8_0 --ssl-key-file k --ssl-cert-file c --path /x",
        );
        assert!(out.args.is_empty());
        assert_eq!(out.dropped.len(), 8);
    }

    #[test]
    fn a_denied_flag_does_not_swallow_the_next_flag() {
        let out = sanitize("--host --no-mmap");
        assert_eq!(out.args, ["--no-mmap"]);
    }

    #[test]
    fn allowed_flags_pass_in_order() {
        let out = sanitize(r#"-b 1024 --temp 0.5 --chat-template-kwargs '{"a":1}'"#);
        assert_eq!(
            out.args,
            [
                "-b",
                "1024",
                "--temp",
                "0.5",
                "--chat-template-kwargs",
                r#"{"a":1}"#
            ]
        );
        assert!(out.dropped.is_empty());
    }
}
