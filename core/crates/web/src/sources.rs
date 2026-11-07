//! Parses paper, wiki and code search bodies and merges papers by DOI. Port of the parsers in electron/sources.cjs.
//! Each parser takes the response body as text. No HTTP happens here, and the arXiv feed is read without an XML crate.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use crate::js::{encode_uri_component, is_js_space, js_trim, to_js_string};

const TITLE_MAX: usize = 200;
const SNIPPET_MAX: usize = 300;
const WIKI_SUMMARY_MAX: usize = 500;

/// One search hit. Absent fields stay `None` or empty, as the JS object leaves them out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SourceResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: &'static str,
    pub year: Option<i64>,
    pub authors: Option<String>,
    pub doi: Option<String>,
    pub pdf: Option<String>,
}

/// The fields a paper parser reads before `paper` cleans them up.
#[derive(Default)]
struct PaperFields {
    title: String,
    doi: String,
    url: String,
    snippet: String,
    source: &'static str,
    year: Option<i64>,
    authors: String,
    pdf: String,
}

/// `text.trim()` for a whitespace run collapsed to one space, as `clip` and the tag reader use.
fn flatten(text: &str) -> String {
    text.split(is_js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `clip`: flattens whitespace and cuts at `max` UTF-16 units with an ellipsis.
fn clip(text: &str, max: usize) -> String {
    let flat = flatten(text);
    if flat.encode_utf16().count() > max {
        format!("{}…", crate::js::utf16_prefix(&flat, max - 1))
    } else {
        flat
    }
}

/// `stripTags`: drops `<...>` runs, then decodes the five entities in the JS order.
fn strip_tags(text: &str) -> String {
    let mut kept = String::new();
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open..].find('>') else {
            break;
        };
        kept.push_str(&rest[..open]);
        rest = &rest[open + close + 1..];
    }
    kept.push_str(rest);
    kept.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// `normaliseDoi`: strips a doi.org URL or `doi:` prefix, lowercases, and keeps only a `10.NNNN/` shaped value.
pub fn normalise_doi(value: &str) -> String {
    let mut doi = js_trim(value);
    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
    ] {
        if let Some(rest) = strip_prefix_ci(doi, prefix) {
            doi = rest;
            break;
        }
    }
    if let Some(rest) = strip_prefix_ci(doi, "doi:") {
        doi = rest;
    }
    let doi = doi.to_lowercase();
    if is_doi_shape(&doi) {
        doi
    } else {
        String::new()
    }
}

fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

/// Matches `^10\.\d{4,9}\/`, where the digit run must end right before the slash.
fn is_doi_shape(doi: &str) -> bool {
    let Some(rest) = doi.strip_prefix("10.") else {
        return false;
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    (4..=9).contains(&digits) && rest.as_bytes().get(digits) == Some(&b'/')
}

/// `authorLine`: up to three names joined, then `et al.` when there are more.
fn author_line(names: impl Iterator<Item = String>) -> String {
    let list: Vec<String> = names
        .map(|name| js_trim(&name).to_owned())
        .filter(|name| !name.is_empty())
        .collect();
    match list.len() {
        0 => String::new(),
        count if count > 3 => format!("{}, et al.", list[..3].join(", ")),
        _ => list.join(", "),
    }
}

/// `paper`: the DOI decides the URL, and empty optional fields are left out.
fn paper(fields: PaperFields) -> SourceResult {
    let doi = normalise_doi(&fields.doi);
    SourceResult {
        title: clip(&fields.title, TITLE_MAX),
        url: if doi.is_empty() {
            fields.url
        } else {
            format!("https://doi.org/{doi}")
        },
        snippet: clip(&fields.snippet, SNIPPET_MAX),
        source: fields.source,
        year: fields.year.filter(|year| *year != 0),
        authors: some_text(fields.authors),
        pdf: some_text(fields.pdf),
        doi: some_text(doi),
    }
}

fn some_text(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

/// A JSON string field, or empty when it is missing or not a string.
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

/// A JSON array, or an empty slice when the value is not an array.
fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[][..], Vec::as_slice)
}

/// A year from a JSON number or numeric string, read the way `Number(...)` reads it.
fn year_of(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(year) => year.trim().parse().ok(),
        _ => None,
    }
}

/// A version or package part in a `${...}` label, where a missing field prints as `undefined`.
fn label_part(value: &Value) -> String {
    match value {
        Value::Null => "undefined".to_owned(),
        other => to_js_string(other),
    }
}

/// The OpenAlex abstract is a word to positions map, rebuilt in position order.
fn openalex_abstract(index: &Value) -> String {
    let Some(map) = index.as_object() else {
        return String::new();
    };
    let mut words: BTreeMap<u64, &str> = BTreeMap::new();
    for (word, positions) in map {
        for position in array(positions) {
            if let Some(at) = position.as_u64() {
                words.insert(at, word);
            }
        }
    }
    words
        .values()
        .filter(|word| !word.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_openalex(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["results"])
        .iter()
        .filter(|row| !text(&row["display_name"]).is_empty())
        .map(|row| {
            let landing = text(&row["primary_location"]["landing_page_url"]);
            let url = if landing.is_empty() {
                text(&row["id"])
            } else {
                landing
            };
            paper(PaperFields {
                title: text(&row["display_name"]).to_owned(),
                doi: text(&row["doi"]).to_owned(),
                url: url.to_owned(),
                snippet: openalex_abstract(&row["abstract_inverted_index"]),
                source: "openalex",
                year: year_of(&row["publication_year"]),
                authors: author_line(
                    array(&row["authorships"])
                        .iter()
                        .map(|entry| text(&entry["author"]["display_name"]).to_owned()),
                ),
                pdf: text(&row["open_access"]["oa_url"]).to_owned(),
            })
        })
        .collect())
}

/// Every `<entry>...</entry>` block, in order.
fn arxiv_entries(xml: &str) -> Vec<&str> {
    const OPEN: &str = "<entry>";
    const CLOSE: &str = "</entry>";
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(OPEN) {
        let block = &rest[start..];
        let Some(end) = block.find(CLOSE) else { break };
        out.push(&block[..end + CLOSE.len()]);
        rest = &block[end + CLOSE.len()..];
    }
    out
}

/// The text of the first `<tag ...>...</tag>` in a block, with tags stripped and whitespace collapsed.
fn tag_text(block: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let Some(start) = block.find(&open) else {
        return String::new();
    };
    let after = &block[start + open.len()..];
    let Some(gt) = after.find('>') else {
        return String::new();
    };
    let content = &after[gt + 1..];
    content
        .find(&format!("</{tag}>"))
        .map_or_else(String::new, |end| flatten(&strip_tags(&content[..end])))
}

/// Every `<author><name>...</name>` pair, as the JS regex reads them.
fn arxiv_author_names(entry: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = entry;
    while let Some(at) = rest.find("<author>") {
        let after = &rest[at + "<author>".len()..];
        let Some(name_at) = after.find("<name>") else {
            break;
        };
        let name = &after[name_at + "<name>".len()..];
        let Some(end) = name.find("</name>") else {
            break;
        };
        names.push(strip_tags(&name[..end]));
        rest = &name[end + "</name>".len()..];
    }
    names
}

/// `http:` to `https:` at the start only, as the JS `replace(/^http:/, ...)` does.
fn to_https(url: &str) -> String {
    match url.strip_prefix("http:") {
        Some(rest) => format!("https:{rest}"),
        None => url.to_owned(),
    }
}

pub fn parse_arxiv(xml: &str) -> Vec<SourceResult> {
    arxiv_entries(xml)
        .into_iter()
        .map(|entry| {
            let id = to_https(&tag_text(entry, "id"));
            let year: String = tag_text(entry, "published").chars().take(4).collect();
            paper(PaperFields {
                title: tag_text(entry, "title"),
                doi: tag_text(entry, "arxiv:doi"),
                url: id.clone(),
                snippet: tag_text(entry, "summary"),
                source: "arxiv",
                year: year.parse().ok(),
                authors: author_line(arxiv_author_names(entry).into_iter()),
                pdf: id.replacen("/abs/", "/pdf/", 1),
            })
        })
        .filter(|row| !row.title.is_empty())
        .collect()
}

/// One Crossref author: given and family, else the organisation name.
fn crossref_author(author: &Value) -> String {
    let full = [text(&author["given"]), text(&author["family"])]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if full.is_empty() {
        text(&author["name"]).to_owned()
    } else {
        full
    }
}

pub fn parse_crossref(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["message"]["items"])
        .iter()
        .filter(|row| !text(&row["title"][0]).is_empty())
        .map(|row| {
            paper(PaperFields {
                title: strip_tags(text(&row["title"][0])),
                doi: text(&row["DOI"]).to_owned(),
                url: text(&row["URL"]).to_owned(),
                snippet: strip_tags(text(&row["abstract"])),
                source: "crossref",
                year: year_of(&row["issued"]["date-parts"][0][0]),
                authors: author_line(array(&row["author"]).iter().map(crossref_author)),
                pdf: String::new(),
            })
        })
        .collect())
}

/// The title key used when a row has no DOI: lowercase words joined by one space.
fn title_key(title: &str) -> String {
    title
        .to_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Sets an empty optional field from the duplicate, as `||=` does.
fn fill_opt(slot: &mut Option<String>, value: &Option<String>) {
    if slot.is_none() {
        slot.clone_from(value);
    }
}

/// Interleaves the provider lists by rank, then keeps the first row for each DOI (or title when there is no DOI).
pub fn merge_papers(lists: &[Vec<SourceResult>]) -> Vec<SourceResult> {
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<SourceResult> = Vec::new();
    for rank in 0..longest {
        for list in lists {
            let Some(row) = list.get(rank) else { continue };
            let key = match &row.doi {
                Some(doi) => doi.clone(),
                None => format!("t:{}", title_key(&row.title)),
            };
            if let Some(&index) = seen.get(&key) {
                let first = &mut out[index];
                if first.snippet.is_empty() {
                    first.snippet.clone_from(&row.snippet);
                }
                if first.year.is_none() {
                    first.year = row.year;
                }
                fill_opt(&mut first.authors, &row.authors);
                fill_opt(&mut first.pdf, &row.pdf);
                if first.doi.is_none() {
                    first.doi.clone_from(&row.doi);
                }
                continue;
            }
            seen.insert(key, out.len());
            out.push(row.clone());
        }
    }
    out
}

pub fn parse_wiki_search(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["query"]["search"])
        .iter()
        .filter(|row| !text(&row["title"]).is_empty())
        .map(|row| {
            let title = text(&row["title"]);
            SourceResult {
                title: title.to_owned(),
                url: format!(
                    "https://en.wikipedia.org/wiki/{}",
                    encode_uri_component(&title.replace(' ', "_"))
                ),
                snippet: clip(&strip_tags(text(&row["snippet"])), SNIPPET_MAX),
                source: "wikipedia",
                ..SourceResult::default()
            }
        })
        .collect())
}

/// `None` when the summary has no extract or no desktop page URL.
pub fn parse_wiki_summary(body: &str) -> Result<Option<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    let url = text(&json["content_urls"]["desktop"]["page"]);
    let extract = text(&json["extract"]);
    if url.is_empty() || extract.is_empty() {
        return Ok(None);
    }
    Ok(Some(SourceResult {
        title: text(&json["title"]).to_owned(),
        url: url.to_owned(),
        snippet: clip(extract, WIKI_SUMMARY_MAX),
        source: "wikipedia",
        ..SourceResult::default()
    }))
}

pub fn parse_wikidata(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["search"])
        .iter()
        .filter(|row| !text(&row["id"]).is_empty() && !text(&row["label"]).is_empty())
        .map(|row| SourceResult {
            title: text(&row["label"]).to_owned(),
            url: format!("https://www.wikidata.org/wiki/{}", text(&row["id"])),
            snippet: clip(text(&row["description"]), SNIPPET_MAX),
            source: "wikidata",
            ..SourceResult::default()
        })
        .collect())
}

pub fn parse_github(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["items"])
        .iter()
        .filter(|row| !text(&row["html_url"]).is_empty())
        .map(|row| {
            let language = match text(&row["language"]) {
                "" => "n/a",
                language => language,
            };
            let stars = match &row["stargazers_count"] {
                Value::Null => "0".to_owned(),
                count => to_js_string(count),
            };
            SourceResult {
                title: text(&row["full_name"]).to_owned(),
                url: text(&row["html_url"]).to_owned(),
                snippet: clip(
                    &format!("{} ({language}, {stars} stars)", text(&row["description"])),
                    SNIPPET_MAX,
                ),
                source: "github",
                ..SourceResult::default()
            }
        })
        .collect())
}

pub fn parse_npm(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["objects"])
        .iter()
        .map(|row| &row["package"])
        .filter(|item| !text(&item["name"]).is_empty())
        .map(|item| {
            let name = text(&item["name"]);
            let link = text(&item["links"]["npm"]);
            SourceResult {
                title: format!("{name}@{}", label_part(&item["version"])),
                url: if link.is_empty() {
                    format!("https://www.npmjs.com/package/{name}")
                } else {
                    link.to_owned()
                },
                snippet: clip(text(&item["description"]), SNIPPET_MAX),
                source: "npm",
                ..SourceResult::default()
            }
        })
        .collect())
}

/// PyPI's exact-name lookup. No row when the info has no name.
pub fn parse_pypi(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    let info = &json["info"];
    let name = text(&info["name"]);
    if name.is_empty() {
        return Ok(Vec::new());
    }
    let package_url = text(&info["package_url"]);
    Ok(vec![SourceResult {
        title: format!("{name} {}", label_part(&info["version"])),
        url: if package_url.is_empty() {
            format!("https://pypi.org/project/{name}/")
        } else {
            package_url.to_owned()
        },
        snippet: clip(text(&info["summary"]), SNIPPET_MAX),
        source: "pypi",
        ..SourceResult::default()
    }])
}

pub fn parse_crates(body: &str) -> Result<Vec<SourceResult>, serde_json::Error> {
    let json: Value = serde_json::from_str(body)?;
    Ok(array(&json["crates"])
        .iter()
        .filter(|row| !text(&row["name"]).is_empty())
        .map(|row| {
            let name = text(&row["name"]);
            SourceResult {
                title: format!("{name} {}", label_part(&row["max_version"])),
                url: format!("https://crates.io/crates/{name}"),
                snippet: clip(text(&row["description"]), SNIPPET_MAX),
                source: "crates",
                ..SourceResult::default()
            }
        })
        .collect())
}
