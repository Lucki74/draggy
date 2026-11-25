//! Pure helpers for the library: passage chunking, vector normalising and scoring, and rank fusion.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

pub const TARGET_CHARS: usize = 1200;
pub const OVERLAP_CHARS: usize = 150;
pub const MIN_CHARS: usize = 80;
pub const TITLED_MIN_CHARS: usize = 20;
pub const MAX_CHUNKS_PER_FILE: usize = 400;
pub const CANDIDATE_DEPTH: usize = 40;
const RRF_K: f64 = 60.0;
const MAX_QUERY_WORDS: usize = 24;

static PARAGRAPH_BREAK: LazyLock<Regex> = LazyLock::new(|| compile(r"\n{2,}"));
static EXPLICIT_HEADING: LazyLock<Regex> = LazyLock::new(|| {
    compile(r"^(#{1,6}\s+\S.*|--- Slide \d+ ---|--- Page \d+ ---|--- Sheet: .*?---)\s*$")
});
static HASH_PREFIX: LazyLock<Regex> = LazyLock::new(|| compile(r"^#{1,6}\s+"));
static DASH_PREFIX: LazyLock<Regex> = LazyLock::new(|| compile(r"^---\s*"));
static DASH_SUFFIX: LazyLock<Regex> = LazyLock::new(|| compile(r"\s*---$"));
static SHEET_PREFIX: LazyLock<Regex> = LazyLock::new(|| compile(r"(?i)^Sheet:\s*"));
static WORD: LazyLock<Regex> = LazyLock::new(|| compile(r"[\p{L}\p{N}_]+"));

/// The patterns are fixed literals, so a compile failure is a programming error the tests catch.
fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("fixed library pattern")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub heading: String,
    pub text: String,
}

/// Every stored vector in one flat buffer, with the chunk id and source of each row.
#[derive(Debug, Default)]
pub struct Matrix {
    pub ids: Vec<i64>,
    pub sources: Vec<i64>,
    pub data: Vec<f32>,
    pub dim: usize,
}

/// A passage that survived fusion. `similarity` is the cosine score when the vector arm found it.
#[derive(Debug, Clone, PartialEq)]
pub struct Fused {
    pub id: i64,
    pub score: f64,
    pub similarity: Option<f64>,
}

fn char_len(text: &str) -> usize {
    text.chars().count()
}

fn last_chars(text: &str, count: usize) -> String {
    let total = char_len(text);
    text.chars().skip(total.saturating_sub(count)).collect()
}

fn split_paragraphs(text: &str) -> Vec<String> {
    let normalised = text.replace("\r\n", "\n");
    PARAGRAPH_BREAK
        .split(&normalised)
        .map(str::trim)
        .filter(|block| !block.is_empty())
        .map(str::to_owned)
        .collect()
}

fn looks_like_title(line: &str) -> bool {
    let starts_well = line
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let ends_plainly = !line.ends_with(['.', '!', '?', ',', ';', ':']);
    let length = char_len(line);
    length > 0 && length < 80 && starts_well && ends_plainly
}

fn heading_text(line: &str) -> String {
    let text = HASH_PREFIX.replace(line, "");
    let text = DASH_PREFIX.replace(&text, "");
    let text = DASH_SUFFIX.replace(&text, "");
    let text = SHEET_PREFIX.replace(&text, "");
    text.trim().to_owned()
}

/// A block that opens with a heading gives its heading and the rest of the block as body.
fn split_leading_heading(block: &str) -> Option<(String, String)> {
    let (first, rest) = match block.find('\n') {
        Some(newline) => (block[..newline].trim(), block[newline + 1..].trim()),
        None => (block.trim(), ""),
    };
    if EXPLICIT_HEADING.is_match(first) {
        return Some((heading_text(first), rest.to_owned()));
    }
    if !block.contains('\n') && looks_like_title(first) {
        return Some((heading_text(first), first.to_owned()));
    }
    None
}

fn flush(buffer: &mut String, heading: &str, chunks: &mut Vec<Chunk>) {
    let body = buffer.trim().to_owned();
    buffer.clear();
    if body.is_empty() {
        return;
    }
    let worth_keeping = char_len(&body) >= MIN_CHARS
        || (!heading.is_empty() && char_len(&body) >= TITLED_MIN_CHARS);
    if worth_keeping {
        chunks.push(Chunk {
            heading: heading.to_owned(),
            text: body,
        });
    }
}

fn append(buffer: &mut String, piece: &str) {
    if piece.is_empty() {
        return;
    }
    if !buffer.is_empty() {
        buffer.push_str("\n\n");
    }
    buffer.push_str(piece);
}

/// Splits text into passages under their headings, with overlap between runs of short paragraphs.
pub fn chunk_text(text: &str) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut heading = String::new();
    let mut buffer = String::new();

    for block in split_paragraphs(text) {
        let mut body = block.clone();
        if let Some((next_heading, rest)) = split_leading_heading(&block) {
            flush(&mut buffer, &heading, &mut chunks);
            heading = next_heading;
            body = rest;
            if body.is_empty() {
                continue;
            }
        }

        if !buffer.is_empty() && char_len(&buffer) + char_len(&body) + 2 > TARGET_CHARS {
            let tail = last_chars(&buffer, OVERLAP_CHARS);
            flush(&mut buffer, &heading, &mut chunks);
            buffer = match tail.find(' ') {
                Some(space) => tail[space + 1..].to_owned(),
                None => String::new(),
            };
        }

        if char_len(&body) > TARGET_CHARS {
            flush(&mut buffer, &heading, &mut chunks);
            let letters: Vec<char> = body.chars().collect();
            let stride = TARGET_CHARS - OVERLAP_CHARS;
            let mut offset = 0;
            while offset < letters.len() {
                let end = (offset + TARGET_CHARS).min(letters.len());
                let slice: String = letters[offset..end].iter().collect();
                let slice = slice.trim().to_owned();
                if char_len(&slice) >= MIN_CHARS {
                    chunks.push(Chunk {
                        heading: heading.clone(),
                        text: slice,
                    });
                }
                if chunks.len() >= MAX_CHUNKS_PER_FILE {
                    return chunks;
                }
                offset += stride;
            }
            continue;
        }

        append(&mut buffer, &body);
        if chunks.len() >= MAX_CHUNKS_PER_FILE {
            return chunks;
        }
    }

    flush(&mut buffer, &heading, &mut chunks);
    chunks.truncate(MAX_CHUNKS_PER_FILE);
    chunks
}

/// Scales a vector to unit length. A zero vector comes back unchanged.
pub fn normalise(vector: &[f32]) -> Vec<f32> {
    let total: f64 = vector
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum();
    let magnitude = total.sqrt();
    if magnitude == 0.0 {
        return vector.to_vec();
    }
    vector
        .iter()
        .map(|value| (f64::from(*value) / magnitude) as f32)
        .collect()
}

/// The dot product, which for normalised vectors is the cosine similarity.
pub fn dot(left: &[f32], right: &[f32]) -> f64 {
    left.iter()
        .zip(right)
        .map(|(a, b)| f64::from(*a) * f64::from(*b))
        .sum()
}

pub fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

pub fn from_blob(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|four| f32::from_le_bytes(*four))
        .collect()
}

/// The typed question as FTS5 will accept it: each word quoted and joined with OR, so no operator
/// or quote in the text can break the query.
pub fn to_search_query(term: &str) -> Option<String> {
    let lowered = term.to_lowercase();
    let words: Vec<&str> = WORD
        .find_iter(&lowered)
        .map(|found| found.as_str())
        .filter(|word| char_len(word) > 1)
        .take(MAX_QUERY_WORDS)
        .collect();
    if words.is_empty() {
        return None;
    }
    Some(
        words
            .iter()
            .map(|word| format!("\"{word}\""))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

/// The best rows by dot product against the query, optionally only one source's rows.
pub fn rank_chunks(
    query: &[f32],
    matrix: &Matrix,
    limit: usize,
    source: Option<i64>,
) -> Vec<(i64, f64)> {
    if matrix.ids.is_empty() || matrix.dim == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(i64, f64)> = matrix
        .ids
        .iter()
        .enumerate()
        .filter(|(index, _)| source.is_none_or(|wanted| matrix.sources[*index] == wanted))
        .map(|(index, id)| {
            let row = &matrix.data[index * matrix.dim..(index + 1) * matrix.dim];
            (*id, dot(query, row))
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.truncate(limit);
    scored
}

fn add_rank(order: &mut Vec<(i64, f64)>, index: &mut HashMap<i64, usize>, id: i64, rank: usize) {
    let share = 1.0 / (RRF_K + rank as f64 + 1.0);
    match index.get(&id) {
        Some(&slot) => order[slot].1 += share,
        None => {
            index.insert(id, order.len());
            order.push((id, share));
        }
    }
}

/// Reciprocal rank fusion: a cosine score and a keyword rank cannot be compared, so fuse on position.
pub fn fuse(vector_hits: &[(i64, f64)], keyword_ids: &[i64], limit: usize) -> Vec<Fused> {
    let mut order: Vec<(i64, f64)> = Vec::new();
    let mut index: HashMap<i64, usize> = HashMap::new();
    for (rank, (id, _)) in vector_hits.iter().enumerate() {
        add_rank(&mut order, &mut index, *id, rank);
    }
    for (rank, id) in keyword_ids.iter().enumerate() {
        add_rank(&mut order, &mut index, *id, rank);
    }

    let similarity: HashMap<i64, f64> = vector_hits.iter().copied().collect();
    order.sort_by(|a, b| b.1.total_cmp(&a.1));
    order.truncate(limit);
    order
        .into_iter()
        .map(|(id, score)| Fused {
            id,
            score,
            similarity: similarity.get(&id).copied(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_heading_names_the_passage_under_it() {
        let text = "# Payment terms\n\nNet thirty days from the invoice date for all standard orders placed.";
        let chunks = chunk_text(text);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].heading, "Payment terms");
        assert!(chunks[0].text.starts_with("Net thirty"));
    }

    #[test]
    fn a_short_untitled_passage_is_dropped() {
        assert!(chunk_text("tiny note").is_empty());
    }

    #[test]
    fn a_long_passage_is_cut_into_overlapping_runs() {
        let text = "word ".repeat(500);
        assert_eq!(chunk_text(&text).len(), 3);
    }

    #[test]
    fn a_question_becomes_quoted_or_terms() {
        assert_eq!(
            to_search_query("Payment-terms, 2024! a").as_deref(),
            Some("\"payment\" OR \"terms\" OR \"2024\"")
        );
        assert_eq!(to_search_query("a b"), None);
    }

    #[test]
    fn a_passage_found_by_both_arms_ranks_first() {
        let fused = fuse(&[(1, 0.9), (2, 0.8)], &[2, 3], 10);
        assert_eq!(fused[0].id, 2);
        assert_eq!(fused[0].similarity, Some(0.8));
        assert_eq!(fused[2].similarity, None);
    }

    #[test]
    fn vectors_normalise_and_survive_a_round_trip() {
        let unit = normalise(&[3.0, 4.0]);
        assert!((unit[0] - 0.6).abs() < 1e-6);
        assert_eq!(from_blob(&to_blob(&unit)), unit);
    }

    #[test]
    fn ranking_respects_the_source_filter() {
        let matrix = Matrix {
            ids: vec![1, 2],
            sources: vec![1, 2],
            data: vec![1.0, 0.0, 0.0, 1.0],
            dim: 2,
        };
        assert_eq!(rank_chunks(&[1.0, 0.0], &matrix, 5, None)[0].0, 1);
        assert_eq!(
            rank_chunks(&[1.0, 0.0], &matrix, 5, Some(2)),
            vec![(2, 0.0)]
        );
    }
}
