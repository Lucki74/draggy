//! Header metadata of a GGUF file, ported from electron/ggufParser.cjs.
//! Numbers are f64, as the reference reads every number as a double, so values above 2^53 round the same way.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};

use tracing::{debug, warn};

use crate::js;

/// "GGUF" read as a little-endian u32.
pub const GGUF_MAGIC: u32 = 0x4655_4747;
/// How much of the file the header read takes: enough for metadata, never the weights.
pub const HEADER_CHUNK_BYTES: u64 = 64 * 1024;
/// The largest read the chat template walk makes at once; a bigger value is read on its own.
const WINDOW_BYTES: u64 = 1024 * 1024;
/// Magic, version, tensor count and key count.
const MIN_HEADER_BYTES: u64 = 24;
const MAX_KEY_BYTES: u64 = 4096;
const CHAT_TEMPLATE_KEY: &[u8] = b"tokenizer.chat_template";
const TOKENS_KEY: &str = "tokenizer.ggml.tokens";

const TYPE_U8: u32 = 0;
const TYPE_I8: u32 = 1;
const TYPE_U16: u32 = 2;
const TYPE_I16: u32 = 3;
const TYPE_U32: u32 = 4;
const TYPE_I32: u32 = 5;
const TYPE_F32: u32 = 6;
const TYPE_BOOL: u32 = 7;
const TYPE_STRING: u32 = 8;
const TYPE_ARRAY: u32 = 9;
const TYPE_U64: u32 = 10;
const TYPE_I64: u32 = 11;
const TYPE_F64: u32 = 12;

/// Why a file could not be read as a GGUF header.
#[derive(Debug, thiserror::Error)]
pub enum GgufError {
    #[error("shorter than a gguf header")]
    TooShort,
    #[error("not a gguf file")]
    BadMagic,
    #[error("unsupported gguf version {0}")]
    UnsupportedVersion(u32),
    #[error("read failed")]
    Io(#[from] std::io::Error),
}

/// What the header says about a model. A `None` number means the key was missing, zero or not a number,
/// which the reference reads the same way.
#[derive(Debug, Clone, PartialEq)]
pub struct GgufHeader {
    pub architecture: String,
    pub context_length: Option<f64>,
    pub block_count: Option<f64>,
    pub embedding_length: Option<f64>,
    pub file_type: Option<f64>,
    pub name: Option<String>,
    pub expert_count: f64,
    pub expert_used_count: f64,
    pub head_count_kv: Option<f64>,
    pub key_length: Option<f64>,
    pub value_length: Option<f64>,
    pub mtp: bool,
    pub tokenizer_model: Option<String>,
    pub tokenizer_pre: Option<String>,
    pub vocab_size: Option<f64>,
    pub version: u32,
}

/// A metadata value as the reference keeps it: every number as a double, arrays as null.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Number(f64),
    Bool(bool),
    String(String),
    /// An array is walked past and kept as null, so only its count is ever read.
    Null,
}

/// The header of a GGUF file held in memory: the bytes it has, read by offset.
trait ByteSource {
    fn size(&self) -> u64;
    /// `len` bytes at `offset`, or None when they run past the end.
    fn fetch(&mut self, offset: u64, len: u64) -> Result<Option<Cow<'_, [u8]>>, GgufError>;

    fn u32_at(&mut self, offset: u64) -> Result<Option<u32>, GgufError> {
        Ok(self
            .fetch(offset, 4)?
            .and_then(|bytes| le::<4>(&bytes))
            .map(u32::from_le_bytes))
    }

    fn u64_at(&mut self, offset: u64) -> Result<Option<u64>, GgufError> {
        Ok(self
            .fetch(offset, 8)?
            .and_then(|bytes| le::<8>(&bytes))
            .map(u64::from_le_bytes))
    }
}

fn le<const N: usize>(bytes: &[u8]) -> Option<[u8; N]> {
    bytes.get(..N)?.try_into().ok()
}

/// Bytes already in memory.
struct Slice<'a>(&'a [u8]);

impl ByteSource for Slice<'_> {
    fn size(&self) -> u64 {
        self.0.len() as u64
    }

    fn fetch(&mut self, offset: u64, len: u64) -> Result<Option<Cow<'_, [u8]>>, GgufError> {
        let range = offset
            .checked_add(len)
            .filter(|end| *end <= self.size())
            .and_then(|end| Some(usize::try_from(offset).ok()?..usize::try_from(end).ok()?));
        Ok(range.and_then(|range| self.0.get(range)).map(Cow::Borrowed))
    }
}

/// A file read through a moving window, so a header much larger than one chunk is walked without holding it all.
struct Window<'r, R> {
    reader: &'r mut R,
    size: u64,
    start: u64,
    buf: Vec<u8>,
}

impl<R: Read + Seek> ByteSource for Window<'_, R> {
    fn size(&self) -> u64 {
        self.size
    }

    fn fetch(&mut self, offset: u64, len: u64) -> Result<Option<Cow<'_, [u8]>>, GgufError> {
        let Some(end) = offset.checked_add(len).filter(|end| *end <= self.size) else {
            return Ok(None);
        };
        if len > WINDOW_BYTES {
            let Ok(count) = usize::try_from(len) else {
                return Ok(None);
            };
            let mut big = vec![0u8; count];
            self.reader.seek(SeekFrom::Start(offset))?;
            self.reader.read_exact(&mut big)?;
            return Ok(Some(Cow::Owned(big)));
        }
        let inside = offset >= self.start && end <= self.start + self.buf.len() as u64;
        if !inside {
            let chunk = WINDOW_BYTES.min(self.size - offset);
            let Ok(count) = usize::try_from(chunk) else {
                return Ok(None);
            };
            let mut buf = vec![0u8; count];
            self.reader.seek(SeekFrom::Start(offset))?;
            self.reader.read_exact(&mut buf)?;
            self.buf = buf;
            self.start = offset;
        }
        let (Ok(from), Ok(to)) = (
            usize::try_from(offset - self.start),
            usize::try_from(end - self.start),
        ) else {
            return Ok(None);
        };
        Ok(self.buf.get(from..to).map(Cow::Borrowed))
    }
}

/// Bytes of a fixed-size value by type, or None for strings, arrays and unknown types.
fn fixed_size(value_type: u32) -> Option<u64> {
    match value_type {
        TYPE_U8 | TYPE_I8 | TYPE_BOOL => Some(1),
        TYPE_U16 | TYPE_I16 => Some(2),
        TYPE_U32 | TYPE_I32 | TYPE_F32 => Some(4),
        TYPE_U64 | TYPE_I64 | TYPE_F64 => Some(8),
        _ => None,
    }
}

fn is_known_type(value_type: u32) -> bool {
    value_type <= TYPE_F64
}

/// The offset `by` bytes past `cursor`, when that stays inside `size`.
fn advance(size: u64, cursor: u64, by: u64) -> Option<u64> {
    cursor.checked_add(by).filter(|end| *end <= size)
}

/// An array whose elements are not fixed size, with the elements still to walk.
struct OpenArray {
    element_type: u32,
    left: u64,
}

/// The offset just past a value of `value_type` at `offset`, or None when it runs past the end.
/// Nested arrays are walked with an explicit stack, so a deep file cannot exhaust the call stack.
fn skip_value<S: ByteSource>(
    source: &mut S,
    offset: u64,
    value_type: u32,
) -> Result<Option<u64>, GgufError> {
    let size = source.size();
    let mut cursor = offset;
    let mut open: Vec<OpenArray> = Vec::new();
    let mut pending = Some(value_type);
    loop {
        let current = match pending.take() {
            Some(current) => current,
            None => match open.last_mut() {
                None => return Ok(Some(cursor)),
                Some(array) if array.left == 0 => {
                    open.pop();
                    continue;
                }
                Some(array) => {
                    array.left -= 1;
                    array.element_type
                }
            },
        };
        match current {
            TYPE_ARRAY => {
                let Some(element_type) = source.u32_at(cursor)? else {
                    return Ok(None);
                };
                let Some(count) = source.u64_at(cursor.saturating_add(4))? else {
                    return Ok(None);
                };
                let Some(body) = advance(size, cursor, 12) else {
                    return Ok(None);
                };
                cursor = body;
                match fixed_size(element_type) {
                    Some(each) => {
                        let Some(total) = count.checked_mul(each) else {
                            return Ok(None);
                        };
                        let Some(end) = advance(size, cursor, total) else {
                            return Ok(None);
                        };
                        cursor = end;
                    }
                    None if count > 0 => open.push(OpenArray {
                        element_type,
                        left: count,
                    }),
                    None => {}
                }
            }
            TYPE_STRING => {
                let Some(length) = source.u64_at(cursor)? else {
                    return Ok(None);
                };
                let Some(total) = length.checked_add(8) else {
                    return Ok(None);
                };
                let Some(end) = advance(size, cursor, total) else {
                    return Ok(None);
                };
                cursor = end;
            }
            other => {
                let Some(each) = fixed_size(other) else {
                    return Ok(None);
                };
                let Some(end) = advance(size, cursor, each) else {
                    return Ok(None);
                };
                cursor = end;
            }
        }
    }
}

/// A string at `offset` (u64 length, then UTF-8 bytes, decoded with replacement) and the offset past it.
fn read_string<S: ByteSource>(
    source: &mut S,
    offset: u64,
) -> Result<Option<(String, u64)>, GgufError> {
    let Some(length) = source.u64_at(offset)? else {
        return Ok(None);
    };
    let Some(start) = offset.checked_add(8) else {
        return Ok(None);
    };
    let Some(end) = start.checked_add(length) else {
        return Ok(None);
    };
    if end > source.size() {
        return Ok(None);
    }
    let Some(bytes) = source.fetch(start, length)? else {
        return Ok(None);
    };
    Ok(Some((String::from_utf8_lossy(&bytes).into_owned(), end)))
}

/// A scalar value at `offset` and the offset past it. Arrays are walked past and read as null.
fn read_scalar<S: ByteSource>(
    source: &mut S,
    offset: u64,
    value_type: u32,
) -> Result<Option<(Value, u64)>, GgufError> {
    if offset >= source.size() {
        return Ok(None);
    }
    if value_type == TYPE_STRING {
        return Ok(read_string(source, offset)?.map(|(text, next)| (Value::String(text), next)));
    }
    if value_type == TYPE_ARRAY {
        return Ok(skip_value(source, offset, value_type)?.map(|next| (Value::Null, next)));
    }
    let Some(each) = fixed_size(value_type) else {
        return Ok(None);
    };
    let Some(bytes) = source.fetch(offset, each)? else {
        return Ok(None);
    };
    Ok(decode(value_type, &bytes).map(|value| (value, offset + each)))
}

fn decode(value_type: u32, bytes: &[u8]) -> Option<Value> {
    let number = match value_type {
        TYPE_BOOL => return Some(Value::Bool(*bytes.first()? != 0)),
        TYPE_U8 => f64::from(*bytes.first()?),
        TYPE_I8 => f64::from((*bytes.first()?) as i8),
        TYPE_U16 => f64::from(u16::from_le_bytes(le(bytes)?)),
        TYPE_I16 => f64::from(i16::from_le_bytes(le(bytes)?)),
        TYPE_U32 => f64::from(u32::from_le_bytes(le(bytes)?)),
        TYPE_I32 => f64::from(i32::from_le_bytes(le(bytes)?)),
        TYPE_F32 => f64::from(f32::from_le_bytes(le(bytes)?)),
        TYPE_U64 => u64::from_le_bytes(le(bytes)?) as f64,
        TYPE_I64 => i64::from_le_bytes(le(bytes)?) as f64,
        TYPE_F64 => f64::from_le_bytes(le(bytes)?),
        _ => return None,
    };
    Some(Value::Number(number))
}

/// The reference's `Number(value)`: a missing key is NaN, an array is 0, a bool is 1 or 0, a string is parsed.
fn to_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Number(number)) => *number,
        Some(Value::Bool(flag)) => f64::from(u8::from(*flag)),
        Some(Value::String(text)) => js::string_to_number(text),
        Some(Value::Null) => 0.0,
    }
}

/// The reference's `Number(x) || null`: zero and NaN are absent.
fn truthy(number: f64) -> Option<f64> {
    if number == 0.0 || number.is_nan() {
        None
    } else {
        Some(number)
    }
}

fn string_of(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        _ => None,
    }
}

/// Logs where a walk stopped. An unknown value type means the file is damaged; a window that ends mid-list is normal.
fn note_stop(window: u64, offset: u64, field: &str, value_type: Option<u32>) {
    match value_type {
        Some(value_type) if !is_known_type(value_type) => {
            warn!(target: "engine.gguf", offset, field, value_type, "unknown value type");
        }
        _ => debug!(target: "engine.gguf", offset, field, window, "header walk stopped"),
    }
}

/// Walks the key-value pairs of a header and builds what the reference reports from them.
fn walk_header<S: ByteSource>(source: &mut S) -> Result<GgufHeader, GgufError> {
    let size = source.size();
    if size < MIN_HEADER_BYTES {
        return Err(GgufError::TooShort);
    }
    if source.u32_at(0)? != Some(GGUF_MAGIC) {
        warn!(target: "engine.gguf", offset = 0_u64, field = "magic", "not a gguf header");
        return Err(GgufError::BadMagic);
    }
    let version = source.u32_at(4)?.ok_or(GgufError::TooShort)?;
    if !(2..=3).contains(&version) {
        warn!(target: "engine.gguf", offset = 4_u64, field = "version", version, "unsupported gguf version");
        return Err(GgufError::UnsupportedVersion(version));
    }
    let kv_count = source.u64_at(16)?.ok_or(GgufError::TooShort)?;

    let mut offset = 24_u64;
    let mut meta: HashMap<String, Value> = HashMap::new();
    // Element counts of arrays, read from their own header: a token list is megabytes, its length is not.
    let mut counts: HashMap<String, f64> = HashMap::new();
    for _ in 0..kv_count {
        if offset >= size {
            break;
        }
        let Some((key, after_key)) = read_string(source, offset)? else {
            note_stop(size, offset, "key", None);
            break;
        };
        let Some(value_type) = source.u32_at(after_key)? else {
            note_stop(size, offset, "value type", None);
            break;
        };
        let value_offset = after_key + 4;
        if value_type == TYPE_ARRAY
            && let Some(count) = source.u64_at(value_offset + 4)?
        {
            counts.insert(key.clone(), count as f64);
        }
        let Some((value, next)) = read_scalar(source, value_offset, value_type)? else {
            note_stop(
                size,
                value_offset,
                &format!("value:{key}"),
                Some(value_type),
            );
            break;
        };
        meta.insert(key, value);
        offset = next;
    }

    let architecture = match meta.get("general.architecture") {
        Some(Value::String(name)) => name.clone(),
        _ => "unknown".to_owned(),
    };
    let field = |suffix: &str| to_number(meta.get(&format!("{architecture}.{suffix}")));

    let head_count = truthy(field("attention.head_count"));
    let embedding_length = truthy(field("embedding_length"));
    let key_length =
        truthy(field("attention.key_length")).or_else(|| match (head_count, embedding_length) {
            (Some(heads), Some(embedding)) => Some(embedding / heads),
            _ => None,
        });
    let vocab_from_list = counts.get(TOKENS_KEY).copied().and_then(truthy);
    let vocab_size = vocab_from_list.or_else(|| truthy(field("vocab_size")));

    Ok(GgufHeader {
        context_length: truthy(field("context_length")),
        block_count: truthy(field("block_count")),
        embedding_length,
        file_type: match meta.get("general.file_type") {
            Some(Value::Number(number)) => Some(*number),
            _ => None,
        },
        name: string_of(meta.get("general.name")),
        expert_count: truthy(field("expert_count")).unwrap_or(0.0),
        expert_used_count: truthy(field("expert_used_count")).unwrap_or(0.0),
        head_count_kv: truthy(field("attention.head_count_kv")).or(head_count),
        key_length,
        value_length: truthy(field("attention.value_length")).or(key_length),
        mtp: field("nextn_predict_layers") > 0.0,
        tokenizer_model: string_of(meta.get("tokenizer.ggml.model")),
        tokenizer_pre: string_of(meta.get("tokenizer.ggml.pre")),
        vocab_size,
        version,
        architecture,
    })
}

/// Parses the header of a GGUF file held in `buf`. Without a tensor-info reader, only the key-value pairs are walked.
/// A walk that stops early (a window or file cut mid-value) keeps what it read, as the reference does.
pub fn parse_header(buf: &[u8]) -> Result<GgufHeader, GgufError> {
    walk_header(&mut Slice(buf))
}

/// Reads the first 64 KiB of a GGUF file and parses its header. A header longer than that keeps what fits.
pub fn read_header<R: Read + Seek>(reader: &mut R) -> Result<GgufHeader, GgufError> {
    let size = reader.seek(SeekFrom::End(0))?;
    if size < MIN_HEADER_BYTES {
        return Err(GgufError::TooShort);
    }
    reader.seek(SeekFrom::Start(0))?;
    let mut buf = Vec::new();
    reader
        .by_ref()
        .take(size.min(HEADER_CHUNK_BYTES))
        .read_to_end(&mut buf)?;
    parse_header(&buf)
}

/// Finds `tokenizer.chat_template` by walking the whole file, skipping the values before it. Returns None when the file has
/// no such string or cannot be walked; the template text is read in full, even past the header window.
pub fn read_chat_template<R: Read + Seek>(reader: &mut R) -> Result<Option<String>, GgufError> {
    let size = reader.seek(SeekFrom::End(0))?;
    find_chat_template(&mut Window {
        reader,
        size,
        start: 0,
        buf: Vec::new(),
    })
}

fn find_chat_template<S: ByteSource>(source: &mut S) -> Result<Option<String>, GgufError> {
    if source.u32_at(0)? != Some(GGUF_MAGIC) {
        return Ok(None);
    }
    match source.u32_at(4)? {
        Some(version) if (2..=3).contains(&version) => {}
        _ => return Ok(None),
    }
    let Some(entries) = source.u64_at(16)? else {
        return Ok(None);
    };

    let mut offset = 24_u64;
    for _ in 0..entries {
        let Some(key_length) = source.u64_at(offset)? else {
            return Ok(None);
        };
        if key_length > MAX_KEY_BYTES {
            debug!(target: "engine.gguf", offset, key_length, "chat template walk stopped");
            return Ok(None);
        }
        let key_start = offset + 8;
        let Some(key) = source.fetch(key_start, key_length)?.map(Cow::into_owned) else {
            return Ok(None);
        };
        let Some(value_type) = source.u32_at(key_start + key_length)? else {
            return Ok(None);
        };
        let value_offset = key_start + key_length + 4;

        if key == CHAT_TEMPLATE_KEY && value_type == TYPE_STRING {
            let Some(length) = source.u64_at(value_offset)? else {
                return Ok(None);
            };
            return Ok(source
                .fetch(value_offset + 8, length)?
                .map(|text| String::from_utf8_lossy(&text).into_owned()));
        }
        match skip_value(source, value_offset, value_type)? {
            Some(next) => offset = next,
            None => {
                note_stop(
                    source.size(),
                    value_offset,
                    &format!("value:{}", String::from_utf8_lossy(&key)),
                    Some(value_type),
                );
                return Ok(None);
            }
        }
    }
    Ok(None)
}

/// Tools and thinking from the chat template. An unreadable template gets the benefit of the doubt: tools, no thinking.
/// A template that opens a thinking block, or switches one on, marks a model that can think.
pub fn capabilities_from_template(template: Option<&str>) -> Vec<&'static str> {
    let mut capabilities = Vec::new();
    if template.is_none_or(|text| text.to_ascii_lowercase().contains("tool")) {
        capabilities.push("tools");
    }
    capabilities.push("completion");
    if let Some(text) = template
        && (text.contains("<think>")
            || text.contains("enable_thinking")
            || text.contains("reasoning_effort"))
    {
        capabilities.push("thinking");
    }
    capabilities
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn str_bytes(text: &str) -> Vec<u8> {
        let mut out = (text.len() as u64).to_le_bytes().to_vec();
        out.extend_from_slice(text.as_bytes());
        out
    }

    fn header(entries: &[Vec<u8>], kv_count: u64) -> Vec<u8> {
        let mut out = GGUF_MAGIC.to_le_bytes().to_vec();
        out.extend_from_slice(&3_u32.to_le_bytes());
        out.extend_from_slice(&0_u64.to_le_bytes());
        out.extend_from_slice(&kv_count.to_le_bytes());
        for entry in entries {
            out.extend_from_slice(entry);
        }
        out
    }

    fn kv(key: &str, value_type: u32, value: &[u8]) -> Vec<u8> {
        let mut out = str_bytes(key);
        out.extend_from_slice(&value_type.to_le_bytes());
        out.extend_from_slice(value);
        out
    }

    fn array(element_type: u32, count: u64, body: &[u8]) -> Vec<u8> {
        let mut out = element_type.to_le_bytes().to_vec();
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn a_deep_nest_of_arrays_is_walked_without_recursion() {
        let mut inner = array(TYPE_U32, 0, &[]);
        for _ in 0..100_000 {
            inner = array(TYPE_ARRAY, 1, &inner);
        }
        let file = header(&[kv(TOKENS_KEY, TYPE_ARRAY, &inner)], 1);
        let parsed = parse_header(&file).expect("header");
        assert_eq!(parsed.vocab_size, Some(1.0));
    }

    #[test]
    fn a_count_with_no_data_is_kept_without_allocating() {
        let file = header(
            &[kv(
                TOKENS_KEY,
                TYPE_ARRAY,
                &array(TYPE_STRING, u64::MAX, &[]),
            )],
            1,
        );
        let parsed = parse_header(&file).expect("header");
        assert_eq!(parsed.vocab_size, Some(u64::MAX as f64));
    }

    #[test]
    fn a_template_longer_than_one_window_is_read_whole() {
        let text = "x".repeat(1_500_000);
        let file = header(
            &[kv(
                "tokenizer.chat_template",
                TYPE_STRING,
                &str_bytes(&text),
            )],
            1,
        );
        let template = read_chat_template(&mut Cursor::new(file)).expect("read");
        assert_eq!(template.as_deref(), Some(text.as_str()));
    }

    #[test]
    fn a_template_after_more_than_one_window_is_found() {
        let filler = vec![0_u8; 1_100_000];
        let file = header(
            &[
                kv(
                    "x.filler",
                    TYPE_ARRAY,
                    &array(TYPE_U8, filler.len() as u64, &filler),
                ),
                kv(
                    "tokenizer.chat_template",
                    TYPE_STRING,
                    &str_bytes("{{ tools }}"),
                ),
            ],
            2,
        );
        let template = read_chat_template(&mut Cursor::new(file)).expect("read");
        assert_eq!(template.as_deref(), Some("{{ tools }}"));
    }

    #[test]
    fn a_template_length_past_the_end_is_absent() {
        let mut value = u64::MAX.to_le_bytes().to_vec();
        value.extend_from_slice(b"{}");
        let file = header(&[kv("tokenizer.chat_template", TYPE_STRING, &value)], 1);
        let template = read_chat_template(&mut Cursor::new(file)).expect("read");
        assert_eq!(template, None);
    }

    #[test]
    fn short_input_is_too_short() {
        assert!(matches!(parse_header(&[0; 10]), Err(GgufError::TooShort)));
        assert!(matches!(
            read_header(&mut Cursor::new(vec![0; 10])),
            Err(GgufError::TooShort)
        ));
    }

    #[test]
    fn capabilities_read_the_template() {
        assert_eq!(capabilities_from_template(None), ["tools", "completion"]);
        assert_eq!(capabilities_from_template(Some("")), ["completion"]);
        assert_eq!(
            capabilities_from_template(Some("<think>")),
            ["completion", "thinking"]
        );
    }
}
