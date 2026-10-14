//! Runs the office golden fixtures (`shared/fixtures/documents/documents-office-*.json`) through the port. The vitest
//! runner in `src/__tests__/fixtures/documents-office.test.ts` calls electron/documents.cjs with the same inputs.
//! Writers are compared by the structure of the file they produce, reduced the same way the TS side reduces it.

use std::collections::HashSet;
use std::io::{Cursor, Read};
use std::path::Path;

use draggy_documents::office_error::OfficeError;
use draggy_documents::office_markdown::{parse_csv, split_into_slides};
use draggy_documents::office_pdf::{TextItem, page_text, read_pdf};
use draggy_documents::office_read::{read_docx, read_pptx, read_xlsx};
use draggy_documents::office_xml::{decode_xml_entities, xml_to_text};
use draggy_documents::office_zip::part_names;
use draggy_documents::{office_docx, office_files, office_pptx, office_xlsx};
use draggy_testkit::{cases, files, fixtures_root};
use office_files::{DOCUMENT_TEXT_LIMIT, EXECUTABLE_EXTENSIONS, MAX_PDF_PAGES};
use regex::Regex;
use serde_json::{Map, Value, json};

const DOCX_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/_rels/document.xml.rels",
];
const PPTX_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/theme/theme1.xml",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/slideLayouts/slideLayout1.xml",
];
const XLSX_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
];
const HEADING_IDS: &[&str] = &[
    "Title", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6",
];
const EMU_PER_INCH: f64 = 914_400.0;

/// The parts of one package, read by name. Every part the reduction asks for goes through here.
struct Package {
    bytes: Vec<u8>,
    names: HashSet<String>,
}

impl Package {
    fn open(bytes: &[u8]) -> Self {
        let names = part_names(bytes).unwrap_or_default().into_iter().collect();
        Self {
            bytes: bytes.to_vec(),
            names,
        }
    }

    fn has(&self, name: &str) -> bool {
        self.names.contains(name)
    }

    /// A part as text. Writers differ on a space before "/>", so both spellings are read the same way.
    fn text(&self, name: &str) -> Option<String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(&self.bytes)).ok()?;
        let mut file = archive.by_name(name).ok()?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).ok()?;
        let text = String::from_utf8_lossy(&buffer).into_owned();
        Some(
            re(r"<([A-Za-z:]+)([^<>]*?)\s+/>")
                .replace_all(&text, "<${1}${2}/>")
                .into_owned(),
        )
    }
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap_or_else(|error| panic!("bad fixture pattern {pattern}: {error}"))
}

fn first(pattern: &str, text: &str) -> Option<String> {
    re(pattern)
        .captures(text)
        .and_then(|found| found.get(1))
        .map(|found| found.as_str().to_owned())
}

fn decode(value: &str) -> String {
    decode_xml_entities(value)
}

// ---- Word -----------------------------------------------------------------------------------------------------

#[derive(Default)]
struct RunProps {
    font: Option<String>,
    size: Option<f64>,
    bold: bool,
    color: Option<String>,
}

fn run_props(rpr: &str) -> RunProps {
    RunProps {
        font: first(r#"<w:rFonts\b[^>]*\bw:ascii="([^"]*)""#, rpr),
        size: first(r#"<w:sz w:val="([0-9]+)""#, rpr).and_then(|v| v.parse().ok()),
        bold: rpr.contains("<w:b/>"),
        color: first(r#"<w:color w:val="([^"]*)""#, rpr),
    }
}

struct Spacing {
    before: Option<f64>,
    after: Option<f64>,
    line: Option<f64>,
}

fn spacing_of(ppr: &str) -> Spacing {
    let tag = first(r"<w:spacing\b([^>]*)/?>", ppr).unwrap_or_default();
    let attr =
        |name: &str| first(&format!(r#"\bw:{name}="([0-9]+)""#), &tag).and_then(|v| v.parse().ok());
    Spacing {
        before: attr("before"),
        after: attr("after"),
        line: attr("line"),
    }
}

fn style_of(styles: &str, id: &str) -> Option<(RunProps, Spacing)> {
    let pattern = format!(r#"<w:style\b[^>]*w:styleId="{id}"[^>]*>([\s\S]*?)</w:style>"#);
    let inner = first(&pattern, styles)?;
    let rpr = first(r"<w:rPr>([\s\S]*?)</w:rPr>", &inner).unwrap_or_default();
    let ppr = first(r"<w:pPr>([\s\S]*?)</w:pPr>", &inner).unwrap_or_default();
    Some((run_props(&rpr), spacing_of(&ppr)))
}

fn style_json(styles: &str, id: &str) -> Value {
    match style_of(styles, id) {
        None => Value::Null,
        Some((run, spacing)) => json!({
            "font": run.font,
            "size": run.size,
            "bold": run.bold,
            "color": run.color,
            "before": spacing.before,
            "after": spacing.after,
        }),
    }
}

fn body_json(styles: &str) -> Value {
    let defaults = first(r"(?s)<w:docDefaults>(.*?)</w:docDefaults>", styles).unwrap_or_default();
    let rpr = first(r"<w:rPrDefault>\s*<w:rPr>([\s\S]*?)</w:rPr>", &defaults).unwrap_or_default();
    let ppr = first(r"<w:pPrDefault>\s*<w:pPr>([\s\S]*?)</w:pPr>", &defaults).unwrap_or_default();
    let doc = run_props(&rpr);
    let spacing = spacing_of(&ppr);
    let normal_color = style_of(styles, "Normal").and_then(|(run, _)| run.color);
    json!({
        "font": doc.font,
        "size": doc.size,
        "color": normal_color.or(doc.color),
        "after": spacing.after,
        "line": spacing.line,
    })
}

/// The list kind each numId stands for: the format of level 0 of its abstract numbering.
fn list_formats(numbering: &str) -> Vec<(String, Option<String>)> {
    let abstract_pattern =
        r"(?s)<w:abstractNum\b[^>]*w:abstractNumId=\x22([0-9]+)\x22[^>]*>(.*?)</w:abstractNum>";
    let abstracts: Vec<(String, String)> = re(abstract_pattern)
        .captures_iter(numbering)
        .map(|found| {
            let body = found.get(2).map_or("", |m| m.as_str());
            let format = first(
                r#"<w:lvl w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]*)"/>"#,
                body,
            )
            .unwrap_or_default();
            (found.get(1).map_or("", |m| m.as_str()).to_owned(), format)
        })
        .collect();
    re(r#"<w:num w:numId="([0-9]+)"[^>]*>\s*<w:abstractNumId w:val="([0-9]+)"/>"#)
        .captures_iter(numbering)
        .map(|found| {
            let num = found.get(1).map_or("", |m| m.as_str()).to_owned();
            let abstract_id = found.get(2).map_or("", |m| m.as_str());
            let format = abstracts
                .iter()
                .find(|(id, _)| id == abstract_id)
                .map(|(_, format)| format.clone());
            (num, format)
        })
        .collect()
}

fn paragraphs_json(xml: &str, formats: &[(String, Option<String>)]) -> Value {
    let paragraphs = re(r"<w:p(?:\s[^>]*)?>([\s\S]*?)</w:p>")
        .captures_iter(xml)
        .map(|found| {
            let inner = found.get(1).map_or("", |m| m.as_str());
            let ppr = first(r"<w:pPr>([\s\S]*?)</w:pPr>", inner).unwrap_or_default();
            let num_id = first(r#"<w:numId w:val="([0-9]+)"/>"#, &ppr);
            let list = num_id.and_then(|id| {
                formats
                    .iter()
                    .find(|(num, _)| *num == id)
                    .and_then(|(_, format)| format.clone())
            });
            let runs: Vec<Value> = re(r"<w:r(?:\s[^>]*)?>([\s\S]*?)</w:r>")
                .captures_iter(inner)
                .map(|run| {
                    let body = run.get(1).map_or("", |m| m.as_str());
                    let rpr = first(r"<w:rPr>([\s\S]*?)</w:rPr>", body).unwrap_or_default();
                    let text: String = re(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>")
                        .captures_iter(body)
                        .map(|t| decode(t.get(1).map_or("", |m| m.as_str())))
                        .collect();
                    json!({
                        "text": text,
                        "bold": rpr.contains("<w:b/>"),
                        "italic": rpr.contains("<w:i/>"),
                        "font": first(r#"<w:rFonts\b[^>]*\bw:ascii="([^"]*)""#, &rpr),
                    })
                })
                .collect();
            let text: String = runs.iter().filter_map(|run| run["text"].as_str()).collect();
            json!({
                "text": text,
                "style": first(r#"<w:pStyle w:val="([^"]*)"/>"#, &ppr),
                "list": list,
                "border": ppr.contains("<w:pBdr>"),
                "runs": runs,
            })
        })
        .collect();
    Value::Array(paragraphs)
}

fn reduce_docx(bytes: &[u8]) -> Value {
    let package = Package::open(bytes);
    let styles = package.text("word/styles.xml").unwrap_or_default();
    let numbering = package.text("word/numbering.xml").unwrap_or_default();
    let document = package.text("word/document.xml").unwrap_or_default();
    let mut styles_out = Map::new();
    for id in HEADING_IDS {
        styles_out.insert((*id).to_owned(), style_json(&styles, id));
    }
    json!({
        "parts": DOCX_PARTS.iter().filter(|name| package.has(name)).collect::<Vec<_>>(),
        "body": body_json(&styles),
        "styles": styles_out,
        "paragraphs": paragraphs_json(&document, &list_formats(&numbering)),
    })
}

// ---- PowerPoint -----------------------------------------------------------------------------------------------

fn inches(emu: f64) -> f64 {
    ((emu / EMU_PER_INCH) * 100.0).round() / 100.0
}

fn slide_number(name: &str) -> u64 {
    first(r"slide([0-9]+)\.xml$", name)
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(0)
}

fn shapes_json(xml: &str) -> Value {
    let shapes = re(r"<p:sp>([\s\S]*?)</p:sp>")
        .captures_iter(xml)
        .map(|found| {
            let shape = found.get(1).map_or("", |m| m.as_str());
            let off = re(r#"<a:off x="(-?[0-9]+)" y="(-?[0-9]+)"/>"#).captures(shape);
            let ext = re(r#"<a:ext cx="([0-9]+)" cy="([0-9]+)"/>"#).captures(shape);
            let run = re(r"(?s)<a:rPr\b([^>]*?)>(.*?)</a:rPr>").captures(shape);
            let attrs = run.as_ref().and_then(|r| r.get(1)).map_or("", |m| m.as_str());
            let inner = run.as_ref().and_then(|r| r.get(2)).map_or("", |m| m.as_str());
            let text: Vec<String> = re(r"<a:p(?:\s[^>]*)?>([\s\S]*?)</a:p>")
                .captures_iter(shape)
                .map(|p| {
                    re(r"<a:t(?:\s[^>]*)?>([\s\S]*?)</a:t>")
                        .captures_iter(p.get(1).map_or("", |m| m.as_str()))
                        .map(|t| decode(t.get(1).map_or("", |m| m.as_str())))
                        .collect()
                })
                .collect();
            let boxed = match (off, ext) {
                (Some(off), Some(ext)) => {
                    let num = |c: &regex::Captures, i: usize| {
                        c.get(i).and_then(|m| m.as_str().parse::<f64>().ok()).unwrap_or(0.0)
                    };
                    json!([
                        inches(num(&off, 1)),
                        inches(num(&off, 2)),
                        inches(num(&ext, 1)),
                        inches(num(&ext, 2)),
                    ])
                }
                _ => Value::Null,
            };
            json!({
                "box": boxed,
                "anchor": first(r#"<a:bodyPr\b[^>]*\banchor="([^"]*)""#, shape),
                "size": first(r#"\bsz="([0-9]+)""#, attrs).and_then(|v| v.parse::<f64>().ok()).map(|v| v / 100.0),
                "bold": first(r#"\bb="(1)""#, attrs).is_some(),
                "font": first(r#"<a:latin typeface="([^"]*)""#, inner),
                "color": first(r#"<a:srgbClr val="([^"]*)""#, inner),
                "text": text,
            })
        })
        .collect();
    Value::Array(shapes)
}

fn reduce_pptx(bytes: &[u8]) -> Value {
    let package = Package::open(bytes);
    let mut slides: Vec<String> = package
        .names
        .iter()
        .filter(|name| re(r"^ppt/slides/slide[0-9]+\.xml$").is_match(name))
        .cloned()
        .collect();
    slides.sort_by_key(|name| slide_number(name));
    let rels: Vec<String> = slides
        .iter()
        .map(|name| name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")
        .filter(|name| package.has(name))
        .collect();
    let mut parts: Vec<String> = PPTX_PARTS
        .iter()
        .filter(|name| package.has(name))
        .map(|name| (*name).to_owned())
        .collect();
    parts.extend(slides.iter().cloned());
    parts.extend(rels);
    let slides_json: Vec<Value> = slides
        .iter()
        .map(|name| json!({ "shapes": shapes_json(&package.text(name).unwrap_or_default()) }))
        .collect();
    json!({ "parts": parts, "slides": slides_json })
}

// ---- Excel ----------------------------------------------------------------------------------------------------

fn column_index(letters: &str) -> usize {
    letters
        .chars()
        .fold(0, |n, ch| n * 26 + (ch as usize - 'A' as usize + 1))
}

fn cell_formats(xml: &str) -> Vec<(bool, Option<String>)> {
    let fonts: Vec<(bool, Option<String>)> = re(r"(?s)<fonts\b[^>]*>(.*?)</fonts>")
        .captures(xml)
        .and_then(|found| found.get(1))
        .map(|block| {
            re(r"<font>([\s\S]*?)</font>")
                .captures_iter(block.as_str())
                .map(|f| {
                    let body = f.get(1).map_or("", |m| m.as_str());
                    (body.contains("<b/>"), first(r#"<name val="([^"]*)""#, body))
                })
                .collect()
        })
        .unwrap_or_default();
    let xfs = first(r"(?s)<cellXfs\b[^>]*>(.*?)</cellXfs>", xml).unwrap_or_default();
    re(r"<xf\b([^>]*?)/?>")
        .captures_iter(&xfs)
        .map(|xf| {
            let attrs = xf.get(1).map_or("", |m| m.as_str());
            let font_id: usize = first(r#"\bfontId="([0-9]+)""#, attrs)
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            fonts.get(font_id).cloned().unwrap_or((false, None))
        })
        .collect()
}

fn shared_strings(xml: &str) -> Vec<String> {
    re(r"<si>([\s\S]*?)</si>")
        .captures_iter(xml)
        .map(|item| {
            re(r"<t(?:\s[^>]*)?>([\s\S]*?)</t>")
                .captures_iter(item.get(1).map_or("", |m| m.as_str()))
                .map(|t| decode(t.get(1).map_or("", |m| m.as_str())))
                .collect()
        })
        .collect()
}

fn rows_json(xml: &str, strings: &[String], formats: &[(bool, Option<String>)]) -> Value {
    let mut rows: Vec<Vec<Value>> = Vec::new();
    for row in re(r"<row\b(?:[^>]*[^/>])?>([\s\S]*?)</row>").captures_iter(xml) {
        let body = row.get(1).map_or("", |m| m.as_str());
        let mut cells: Vec<(usize, Value)> = Vec::new();
        for cell in re(r"<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)").captures_iter(body) {
            let attrs = cell.get(1).map_or("", |m| m.as_str());
            let inner = cell.get(2).map_or("", |m| m.as_str());
            let col = column_index(
                &first(r#"\br="([A-Z]+)[0-9]+""#, attrs).unwrap_or_else(|| "A".to_owned()),
            );
            let style_index: usize = first(r#"\bs="([0-9]+)""#, attrs)
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let (bold, font) = formats.get(style_index).cloned().unwrap_or((false, None));
            let kind = first(r#"\bt="([^"]*)""#, attrs);
            let raw = first(r"<v>([^<]*)</v>", inner);
            let value = match kind.as_deref() {
                Some("s") => {
                    let index: usize = raw.as_deref().unwrap_or("0").parse().unwrap_or(0);
                    json!(strings.get(index).cloned().unwrap_or_default())
                }
                Some("inlineStr") => {
                    let text: String = re(r"<t(?:\s[^>]*)?>([\s\S]*?)</t>")
                        .captures_iter(inner)
                        .map(|t| t.get(1).map_or("", |m| m.as_str()).to_owned())
                        .collect();
                    json!(decode(&text))
                }
                Some("str") => json!(decode(raw.as_deref().unwrap_or(""))),
                _ => match raw {
                    None => json!(""),
                    Some(raw) => json!(raw.parse::<f64>().unwrap_or(f64::NAN)),
                },
            };
            cells.push((col, json!({ "v": value, "bold": bold, "font": font })));
        }
        let width = cells.iter().map(|(col, _)| *col).max().unwrap_or(0);
        let mut line: Vec<Value> = (0..width)
            .map(|_| json!({ "v": "", "bold": false, "font": null }))
            .collect();
        for (col, cell) in cells {
            line[col - 1] = cell;
        }
        rows.push(line);
    }
    json!(rows)
}

fn reduce_xlsx(bytes: &[u8]) -> Value {
    let package = Package::open(bytes);
    let workbook = package.text("xl/workbook.xml").unwrap_or_default();
    let strings = shared_strings(&package.text("xl/sharedStrings.xml").unwrap_or_default());
    let formats = cell_formats(&package.text("xl/styles.xml").unwrap_or_default());
    let sheets: Vec<Value> = re(r#"<sheet\b[^>]*?\bname="([^"]*)""#)
        .captures_iter(&workbook)
        .enumerate()
        .map(|(index, found)| {
            let name = decode(found.get(1).map_or("", |m| m.as_str()));
            let xml = package
                .text(&format!("xl/worksheets/sheet{}.xml", index + 1))
                .unwrap_or_default();
            json!({ "name": name, "rows": rows_json(&xml, &strings, &formats) })
        })
        .collect();
    json!({
        "parts": XLSX_PARTS.iter().filter(|name| package.has(name)).collect::<Vec<_>>(),
        "sheets": sheets,
    })
}

// ---- Fixture dispatch -----------------------------------------------------------------------------------------

fn arg(args: &[Value], index: usize) -> &str {
    args.get(index).and_then(Value::as_str).unwrap_or("")
}

/// A new folder for one write the fixture reads back. The caller removes it.
fn scratch_dir() -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let index = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "draggy-office-fixture-{}-{index}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("makes a scratch folder");
    dir
}

/// Writes content as the file name asks, then reduces what was written: Office packages by their structure, other
/// files as text.
fn written_as(name: &str, content: &str) -> Value {
    let dir = scratch_dir();
    let file = dir.join(name);
    let result = office_files::write_generated_file(&file, content)
        .and_then(|()| std::fs::read(&file).map_err(OfficeError::from))
        .map(
            |bytes| match name.to_ascii_lowercase().rsplit('.').next().unwrap_or("") {
                "docx" => reduce_docx(&bytes),
                "pptx" => reduce_pptx(&bytes),
                "xlsx" => reduce_xlsx(&bytes),
                _ => json!(String::from_utf8_lossy(&bytes)),
            },
        );
    let _ = std::fs::remove_dir_all(&dir);
    outcome(result, |value| value)
}

/// Writes content as the file name asks, then reads the text back out of the written file.
fn round_trip(name: &str, content: &str) -> Value {
    let dir = scratch_dir();
    let file = dir.join(name);
    let result = office_files::write_generated_file(&file, content)
        .and_then(|()| std::fs::read(&file).map_err(OfficeError::from))
        .and_then(|bytes| office_files::extract_text(name, &bytes));
    let _ = std::fs::remove_dir_all(&dir);
    outcome(result, Value::from)
}

/// What the fixtures pin of a long text: its section headings, its length in UTF-16 units and its ends.
fn summarize_text(text: &str) -> Value {
    let headings: Vec<&str> = text
        .split('\n')
        .filter(|line| line.starts_with("--- ") && line.ends_with(" ---"))
        .collect();
    let units: Vec<u16> = text.encode_utf16().collect();
    let head = String::from_utf16_lossy(&units[..units.len().min(30)]);
    let tail = String::from_utf16_lossy(&units[units.len().saturating_sub(30)..]);
    json!({ "headings": headings, "length": units.len(), "head": head, "tail": tail })
}

/// A sample named as the fixtures name it, such as `samples/report.docx`, read from the fixture folder.
fn sample_bytes(name: Option<&str>) -> Vec<u8> {
    match name {
        None => Vec::new(),
        Some(name) => std::fs::read(Path::new(&fixtures_root()).join("documents").join(name))
            .unwrap_or_else(|error| panic!("cannot read sample {name}: {error}")),
    }
}

fn outcome<T>(
    result: Result<T, draggy_documents::office_error::OfficeError>,
    to_json: impl FnOnce(T) -> Value,
) -> Value {
    match result {
        Ok(value) => to_json(value),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

/// Calls the function a case names. Errors come back as `{ "error": message }`, as the TS runner reports them.
fn run(name: &str, args: &[Value]) -> Value {
    match name {
        "writeDocx" => match office_docx::docx_bytes(arg(args, 0)) {
            Ok((bytes, _)) => reduce_docx(&bytes),
            Err(error) => json!({ "error": error.to_string() }),
        },
        "writePptx" => match office_pptx::pptx_bytes(arg(args, 0)) {
            Ok((bytes, _)) => reduce_pptx(&bytes),
            Err(error) => json!({ "error": error.to_string() }),
        },
        "writeXlsx" => match office_xlsx::xlsx_bytes(arg(args, 0)) {
            Ok((bytes, _)) => reduce_xlsx(&bytes),
            Err(error) => json!({ "error": error.to_string() }),
        },
        "readDocx" => outcome(read_docx(&sample_bytes(Some(arg(args, 0)))), Value::from),
        "readPptx" => outcome(read_pptx(&sample_bytes(Some(arg(args, 0)))), Value::from),
        "readXlsx" => outcome(read_xlsx(&sample_bytes(Some(arg(args, 0)))), Value::from),
        "readPdf" => outcome(read_pdf(&sample_bytes(Some(arg(args, 0)))), Value::from),
        "writeGeneratedFile" => written_as(arg(args, 0), arg(args, 1)),
        "writeThenRead" => round_trip(arg(args, 0), arg(args, 1)),
        "readPdfSummary" => outcome(read_pdf(&sample_bytes(Some(arg(args, 0)))), |text| {
            summarize_text(&text)
        }),
        "extractText" => {
            let sample = args.get(1).and_then(Value::as_str);
            outcome(
                office_files::extract_text(arg(args, 0), &sample_bytes(sample)),
                Value::from,
            )
        }
        "findZipEntries" => outcome(part_names(arg(args, 0).as_bytes()), |_| json!("ok")),
        "splitIntoSlides" => json!(split_into_slides(arg(args, 0))),
        "parseCsv" => json!(parse_csv(arg(args, 0))),
        "decodeXmlEntities" => json!(decode_xml_entities(arg(args, 0))),
        "xmlToText" => outcome(
            xml_to_text(arg(args, 0), arg(args, 1), arg(args, 2)),
            Value::from,
        ),
        "isExecutableName" => json!(office_files::is_executable_name(arg(args, 0))),
        "pageText" => {
            let items: Vec<TextItem> = args
                .first()
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| TextItem {
                            text: item.get("str").and_then(Value::as_str),
                            has_eol: item.get("hasEOL").and_then(Value::as_bool).unwrap_or(false),
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!(page_text(&items))
        }
        "constants" => {
            let mut extensions: Vec<&str> = EXECUTABLE_EXTENSIONS.to_vec();
            extensions.sort_unstable();
            json!({
                "DOCUMENT_TEXT_LIMIT": DOCUMENT_TEXT_LIMIT,
                "MAX_PDF_PAGES": MAX_PDF_PAGES,
                "EXECUTABLE_EXTENSIONS": extensions,
            })
        }
        other => panic!("no fixture function named {other}"),
    }
}

/// Whole numbers as integers, so `22.0` from Rust and `22` from the fixture compare equal.
fn normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 9.0e15 => json!(float as i64),
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, normalize(item)))
                .collect(),
        ),
        other => other,
    }
}

fn short(value: &Value) -> String {
    let text = value.to_string();
    if text.len() > 300 {
        let cut = (0..=300)
            .rev()
            .find(|&i| text.is_char_boundary(i))
            .unwrap_or(0);
        format!("{}...", &text[..cut])
    } else {
        text
    }
}

#[test]
fn office_fixtures_match_the_reference() {
    let mut failures = Vec::new();
    let mut total = 0;
    for file in files("documents")
        .into_iter()
        .filter(|name| name.starts_with("documents-office-"))
    {
        for case in cases("documents", &file) {
            total += 1;
            let name = case["name"].as_str().unwrap_or("?");
            let function = case["input"]["fn"].as_str().unwrap_or("");
            let args = case["input"]["args"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let actual = normalize(run(function, &args));
            let expected = normalize(case["expected"].clone());
            if actual != expected {
                failures.push(format!(
                    "{file} / {name}\n  expected {}\n  actual   {}",
                    short(&expected),
                    short(&actual)
                ));
            }
        }
    }
    assert!(
        total > 60,
        "expected the office fixtures, found {total} cases"
    );
    assert!(
        failures.is_empty(),
        "{} of {total} cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
