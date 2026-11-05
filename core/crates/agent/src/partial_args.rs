//! Scans tool-call arguments that are still arriving. Display state only: never stored, sent to the model or run.
//! `win/src/agent/partialArgs.ts` is the TypeScript twin, and `shared/fixtures/agent/partialArgs.json` pins both.

/// One key and value pair. `open` is true while the value is still being written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartialArg {
    pub key: String,
    /// A string value is decoded. Anything else (number, object, array, literal) is its raw JSON text.
    pub value: String,
    pub is_string: bool,
    pub open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PartialArgs {
    pub entries: Vec<PartialArg>,
    /// The text stopped being a JSON object. Show the raw text instead of trusting the pairs.
    pub invalid: bool,
    /// The closing brace has arrived.
    pub complete: bool,
}

impl PartialArgs {
    /// The first pair whose key is one of `keys`, in text order.
    pub fn first(&self, keys: &[&str]) -> Option<&PartialArg> {
        self.entries.iter().find(|e| keys.contains(&e.key.as_str()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Start,
    KeyOrEnd,
    Key,
    Colon,
    Value,
    Str,
    Nested,
    Literal,
    After,
    Done,
    Bad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Escape {
    None,
    Backslash,
    Hex,
}

const TAIL: usize = 32;

fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\n' | '\r' | '\t')
}

fn is_line_break(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Resumes from its last offset. Callers pass the whole text so far; text that is not an extension of the last
/// call starts the scan over.
#[derive(Debug)]
pub struct PartialArgsScanner {
    pos: usize,
    tail: String,
    state: State,
    entries: Vec<PartialArg>,
    key_buf: String,
    in_key: bool,
    escape: Escape,
    hex: String,
    high: Option<u16>,
    depth: usize,
    nest_in_str: bool,
    nest_esc: bool,
    scanned: usize,
}

impl Default for PartialArgsScanner {
    fn default() -> Self {
        Self {
            pos: 0,
            tail: String::new(),
            state: State::Start,
            entries: Vec::new(),
            key_buf: String::new(),
            in_key: false,
            escape: Escape::None,
            hex: String::new(),
            high: None,
            depth: 0,
            nest_in_str: false,
            nest_esc: false,
            scanned: 0,
        }
    }
}

impl PartialArgsScanner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bytes scanned in all. Tests use it to prove the scan resumes.
    pub fn scanned(&self) -> usize {
        self.scanned
    }

    pub fn update(&mut self, text: &str) -> PartialArgs {
        let extends = text.len() >= self.pos
            && text.is_char_boundary(self.pos)
            && text[..self.pos].ends_with(&self.tail);
        if !extends {
            let scanned = self.scanned;
            *self = Self::default();
            self.scanned = scanned;
        }
        self.scanned += text.len() - self.pos;
        self.scan(text);
        self.pos = text.len();
        let mut start = text.len().saturating_sub(TAIL);
        while !text.is_char_boundary(start) {
            start += 1;
        }
        self.tail = text[start..].to_string();
        PartialArgs {
            entries: self.entries.clone(),
            invalid: self.state == State::Bad,
            complete: self.state == State::Done,
        }
    }

    fn sink(&mut self, s: &str) {
        if self.in_key {
            self.key_buf.push_str(s);
        } else if let Some(entry) = self.entries.last_mut() {
            entry.value.push_str(s);
        }
    }

    fn flush_high(&mut self) {
        if self.high.take().is_some() {
            // A lone surrogate cannot live in a Rust string.
            self.sink("\u{FFFD}");
        }
    }

    fn put(&mut self, s: &str) {
        self.flush_high();
        self.sink(s);
    }

    fn unit(&mut self, code: u16) {
        if let Some(high) = self.high
            && (0xDC00..=0xDFFF).contains(&code)
        {
            self.high = None;
            let c = char::decode_utf16([high, code])
                .next()
                .and_then(Result::ok)
                .unwrap_or('\u{FFFD}');
            self.sink(&c.to_string());
            return;
        }
        if (0xD800..=0xDBFF).contains(&code) {
            self.flush_high();
            self.high = Some(code);
            return;
        }
        let c = char::from_u32(u32::from(code)).unwrap_or('\u{FFFD}');
        self.put(&c.to_string());
    }

    /// Feeds one character to the open string. Returns true when the string ended.
    fn str_char(&mut self, c: char) -> bool {
        if self.escape == Escape::Backslash {
            self.escape = Escape::None;
            // A backslash before a raw line break ends the string. Models cut off mid-escape do this.
            if is_line_break(c) {
                self.put("");
                return true;
            }
            match c {
                'n' => self.put("\n"),
                'r' => self.put("\r"),
                't' => self.put("\t"),
                '"' | '\\' | '/' | 'b' | 'f' => self.put(&c.to_string()),
                'u' => {
                    self.escape = Escape::Hex;
                    self.hex.clear();
                }
                other => self.put(&format!("\\{other}")),
            }
            return false;
        }
        if self.escape == Escape::Hex {
            if c.is_ascii_hexdigit() {
                self.hex.push(c);
                if self.hex.len() == 4 {
                    self.escape = Escape::None;
                    let code = u16::from_str_radix(&self.hex, 16).unwrap_or(0xFFFD);
                    self.unit(code);
                }
                return false;
            }
            let literal = format!("\\u{}", self.hex);
            self.put(&literal);
            self.escape = Escape::None;
        }
        match c {
            '\\' => {
                self.escape = Escape::Backslash;
                false
            }
            '"' => {
                self.put("");
                true
            }
            other => {
                self.put(&other.to_string());
                false
            }
        }
    }

    fn end_value(&mut self) {
        if let Some(entry) = self.entries.last_mut() {
            entry.open = false;
        }
        self.state = State::After;
    }

    fn push_entry(&mut self, value: &str, is_string: bool) {
        self.entries.push(PartialArg {
            key: self.key_buf.clone(),
            value: value.to_string(),
            is_string,
            open: true,
        });
    }

    fn scan(&mut self, text: &str) {
        let mut i = self.pos;
        while i < text.len() {
            // Plain runs are copied in one slice, so a large file body costs one append per chunk.
            if matches!(self.state, State::Key | State::Str)
                && self.escape == Escape::None
                && self.high.is_none()
            {
                let rest = &text[i..];
                let run = rest.find(['"', '\\']).unwrap_or(rest.len());
                if run > 0 {
                    self.sink(&rest[..run]);
                    i += run;
                    continue;
                }
            }
            let Some(c) = text[i..].chars().next() else {
                break;
            };
            let width = c.len_utf8();
            match self.state {
                State::Start => {
                    if is_space(c) {
                        i += width;
                    } else if c == '{' {
                        self.state = State::KeyOrEnd;
                        i += width;
                    } else {
                        self.state = State::Bad;
                    }
                }
                State::KeyOrEnd => {
                    if is_space(c) {
                        i += width;
                    } else if c == '"' {
                        self.state = State::Key;
                        self.in_key = true;
                        self.key_buf.clear();
                        self.escape = Escape::None;
                        i += width;
                    } else if c == '}' {
                        self.state = State::Done;
                        i += width;
                    } else {
                        self.state = State::Bad;
                    }
                }
                State::Colon => {
                    if is_space(c) {
                        i += width;
                    } else if c == ':' {
                        self.state = State::Value;
                        i += width;
                    } else {
                        self.state = State::Bad;
                    }
                }
                State::Value => {
                    if is_space(c) {
                        i += width;
                        continue;
                    }
                    if matches!(c, '}' | ',' | ']' | ':') {
                        self.state = State::Bad;
                        continue;
                    }
                    if c == '"' {
                        self.push_entry("", true);
                        self.state = State::Str;
                        self.escape = Escape::None;
                    } else if c == '{' || c == '[' {
                        self.push_entry(&c.to_string(), false);
                        self.state = State::Nested;
                        self.depth = 1;
                        self.nest_in_str = false;
                        self.nest_esc = false;
                    } else {
                        self.push_entry(&c.to_string(), false);
                        self.state = State::Literal;
                    }
                    i += width;
                }
                State::Key | State::Str => {
                    let ended = self.str_char(c);
                    i += width;
                    if ended {
                        if self.state == State::Key {
                            self.in_key = false;
                            self.state = State::Colon;
                        } else {
                            self.end_value();
                        }
                    }
                }
                State::Nested => {
                    if let Some(entry) = self.entries.last_mut() {
                        entry.value.push(c);
                    }
                    i += width;
                    if self.nest_in_str {
                        if self.nest_esc {
                            self.nest_esc = false;
                        } else if c == '\\' {
                            self.nest_esc = true;
                        } else if c == '"' {
                            self.nest_in_str = false;
                        }
                    } else if c == '"' {
                        self.nest_in_str = true;
                    } else if c == '{' || c == '[' {
                        self.depth += 1;
                    } else if c == '}' || c == ']' {
                        self.depth -= 1;
                        if self.depth == 0 {
                            self.end_value();
                        }
                    }
                }
                State::Literal => {
                    if is_space(c) {
                        self.end_value();
                        i += width;
                    } else if c == ',' {
                        self.close_last();
                        self.state = State::KeyOrEnd;
                        i += width;
                    } else if c == '}' {
                        self.close_last();
                        self.state = State::Done;
                        i += width;
                    } else if matches!(c, '"' | '{' | '[' | ':') {
                        self.state = State::Bad;
                    } else {
                        if let Some(entry) = self.entries.last_mut() {
                            entry.value.push(c);
                        }
                        i += width;
                    }
                }
                State::After => {
                    if is_space(c) {
                        i += width;
                    } else if c == ',' {
                        self.state = State::KeyOrEnd;
                        i += width;
                    } else if c == '}' {
                        self.state = State::Done;
                        i += width;
                    } else {
                        self.state = State::Bad;
                    }
                }
                State::Done => {
                    if is_space(c) {
                        i += width;
                    } else {
                        self.state = State::Bad;
                    }
                }
                State::Bad => i = text.len(),
            }
        }
    }

    fn close_last(&mut self) {
        if let Some(entry) = self.entries.last_mut() {
            entry.open = false;
        }
    }
}

/// One-shot parse of the text so far.
pub fn parse_partial_args(text: &str) -> PartialArgs {
    PartialArgsScanner::new().update(text)
}
