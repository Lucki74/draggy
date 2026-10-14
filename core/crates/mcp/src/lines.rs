//! Splits what a server writes to stdout into JSON-RPC messages. Only the line framing lives here; reading the pipe is the caller's job.

use serde_json::Value;

use crate::js::{trim, utf16_len};

/// Holds back the tail of a chunk until the newline that completes it arrives.
#[derive(Debug, Default)]
pub struct LineBuffer {
    pending: String,
}

impl LineBuffer {
    /// The lines a chunk completes, without their newlines. A line split across chunks comes out whole, once.
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.pending.push_str(chunk);

        let Some(last) = self.pending.rfind('\n') else {
            return Vec::new();
        };

        let complete: String = self.pending.drain(..=last).collect();
        complete[..complete.len() - 1]
            .split('\n')
            .map(str::to_owned)
            .collect()
    }
}

/// What one complete line turned out to be.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    /// Nothing but whitespace.
    Blank,
    /// A JSON value; `bytes` is its trimmed length in UTF-16 units, which is what the log records.
    Message { value: Value, bytes: usize },
    /// Text that is not JSON, such as a server's own logging. Ignored, but its size is logged.
    Junk { bytes: usize },
}

/// Trims a line and reads it as JSON. Servers also write plain text to stdout, so a line that fails to parse is junk, not an error.
pub fn parse_line(raw: &str) -> Parsed {
    let trimmed = trim(raw);
    if trimmed.is_empty() {
        return Parsed::Blank;
    }

    let bytes = utf16_len(trimmed);
    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => Parsed::Message { value, bytes },
        Err(_) => Parsed::Junk { bytes },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_split_across_chunks_comes_out_once() {
        let mut buffer = LineBuffer::default();
        assert!(buffer.push("{\"id\":1,\"resu").is_empty());
        assert_eq!(
            buffer.push("lt\":2}\n"),
            vec!["{\"id\":1,\"result\":2}".to_owned()]
        );
    }

    #[test]
    fn junk_is_counted_in_utf16_units() {
        assert_eq!(parse_line("a\u{1F600}"), Parsed::Junk { bytes: 3 });
    }
}
