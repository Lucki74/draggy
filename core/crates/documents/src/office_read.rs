//! Reads the text of .docx, .pptx and .xlsx packages. Ports readDocx, readPptx and readXlsx in electron/documents.cjs.
//! Word and PowerPoint text comes from the XML directly; Excel cells are resolved through the shared strings.

use std::sync::LazyLock;

use regex::Regex;

use crate::js::{Pattern, captures, compile, trim};
use crate::office_error::OfficeError;
use crate::office_xml::{decode_xml_entities, xml_to_text};
use crate::office_zip::Package;

static SLIDE_PART: Pattern = LazyLock::new(|| compile(r"^ppt/slides/slide([0-9]+)\.xml$"));
static CELL: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)").ok());
static ROW: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"<row\b(?:[^>]*[^/>])?>([\s\S]*?)</row>").ok());

/// The text of a Word document: each run's text, with a line break at the end of every paragraph.
pub fn read_docx(bytes: &[u8]) -> Result<String, OfficeError> {
    let mut package = Package::open(bytes)?;
    let xml = package
        .text("word/document.xml")?
        .ok_or(OfficeError::NoBody)?;
    xml_to_text(&xml, "w:t", "</w:p>")
}

/// The text of a deck: one section per slide in slide order, each headed by its number.
pub fn read_pptx(bytes: &[u8]) -> Result<String, OfficeError> {
    let mut package = Package::open(bytes)?;
    let mut slides: Vec<(u64, String)> = package
        .names()
        .into_iter()
        .filter_map(|name| {
            let number = captures(&SLIDE_PART, &name)?
                .get(1)?
                .as_str()
                .parse::<u64>()
                .ok()?;
            Some((number, name))
        })
        .collect();
    if slides.is_empty() {
        return Err(OfficeError::NoSlides);
    }
    slides.sort_by_key(|(number, _)| *number);

    let mut sections = Vec::with_capacity(slides.len());
    for (index, (_, name)) in slides.iter().enumerate() {
        let xml = package.text(name)?.unwrap_or_default();
        let text = xml_to_text(&xml, "a:t", "</a:p>")?;
        sections.push(format!("--- Slide {} ---\n{}", index + 1, trim(&text)));
    }
    Ok(sections.join("\n\n"))
}

/// The text of a workbook: one section per sheet, each row as a CSV line.
pub fn read_xlsx(bytes: &[u8]) -> Result<String, OfficeError> {
    let mut package = Package::open(bytes)?;
    let workbook = package
        .text("xl/workbook.xml")?
        .ok_or_else(|| OfficeError::Corrupt("the workbook part is missing".to_owned()))?;
    let relationships = package
        .text("xl/_rels/workbook.xml.rels")?
        .unwrap_or_default();
    let strings = shared_strings(&mut package)?;
    let date_styles = date_styles(&package.text("xl/styles.xml")?.unwrap_or_default());

    let mut parts = Vec::new();
    for (index, sheet) in sheet_tags(&workbook).into_iter().enumerate() {
        let target = relationship_target(&relationships, &sheet.relationship_id)
            .unwrap_or_else(|| format!("xl/worksheets/sheet{}.xml", index + 1));
        parts.push(format!("--- Sheet: {} ---", sheet.name));
        let xml = package.text(&target)?.unwrap_or_default();
        parts.extend(csv_rows(&xml, &strings, &date_styles)?);
    }
    Ok(parts.join("\n"))
}

struct SheetTag {
    name: String,
    relationship_id: String,
}

fn sheet_tags(workbook: &str) -> Vec<SheetTag> {
    static SHEET: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"<sheet\b[^>]*>").ok());
    let Some(regex) = SHEET.as_ref() else {
        return Vec::new();
    };
    regex
        .find_iter(workbook)
        .map(|found| SheetTag {
            name: attribute(found.as_str(), "name").unwrap_or_default(),
            relationship_id: attribute(found.as_str(), "r:id").unwrap_or_default(),
        })
        .collect()
}

/// The value of one attribute in a start tag, with its entities decoded. The name must follow a space, so `id`
/// does not match inside `Target`.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let mut rest = tag;
    while let Some(index) = rest.find(&needle) {
        let after = &rest[index + needle.len()..];
        if rest[..index].ends_with(char::is_whitespace) {
            let end = after.find('"')?;
            return Some(decode_xml_entities(&after[..end]));
        }
        rest = after;
    }
    None
}

/// Where a relationship id points inside the package, as a part name.
fn relationship_target(relationships: &str, id: &str) -> Option<String> {
    static RELATIONSHIP: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<Relationship\b[^>]*/?>").ok());
    let regex = RELATIONSHIP.as_ref()?;
    regex.find_iter(relationships).find_map(|found| {
        if attribute(found.as_str(), "Id").as_deref() != Some(id) {
            return None;
        }
        let target = attribute(found.as_str(), "Target")?;
        Some(match target.strip_prefix('/') {
            Some(absolute) => absolute.to_owned(),
            None => format!("xl/{target}"),
        })
    })
}

/// The shared strings table, each entry's text joined across its rich-text runs. Phonetic runs are not part of the text.
fn shared_strings(package: &mut Package<'_>) -> Result<Vec<String>, OfficeError> {
    static ITEM: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<si>([\s\S]*?)</si>").ok());
    static PHONETIC: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<rPh\b[^>]*>[\s\S]*?</rPh>").ok());
    static TEXT: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<t(?:\s[^>]*)?>([\s\S]*?)</t>").ok());
    let Some(xml) = package.text("xl/sharedStrings.xml")? else {
        return Ok(Vec::new());
    };
    let (Some(items), Some(phonetic), Some(texts)) =
        (ITEM.as_ref(), PHONETIC.as_ref(), TEXT.as_ref())
    else {
        return Ok(Vec::new());
    };
    Ok(items
        .captures_iter(&xml)
        .map(|item| {
            let body = phonetic.replace_all(item.get(1).map_or("", |m| m.as_str()), "");
            texts
                .captures_iter(&body)
                .map(|text| decode_xml_entities(text.get(1).map_or("", |m| m.as_str())))
                .collect()
        })
        .collect())
}

/// Whether each cell style, by its index in cellXfs, shows a date. Custom formats win over the built-in table.
fn date_styles(styles: &str) -> Vec<bool> {
    static NUMBER_FORMAT: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<numFmt\b[^>]*>").ok());
    static CELL_XFS: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<cellXfs\b[^>]*>([\s\S]*?)</cellXfs>").ok());
    static XF: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"<xf\b[^>]*>").ok());
    let (Some(formats), Some(cell_xfs), Some(xfs)) =
        (NUMBER_FORMAT.as_ref(), CELL_XFS.as_ref(), XF.as_ref())
    else {
        return Vec::new();
    };
    let custom: Vec<(u64, String)> = formats
        .find_iter(styles)
        .filter_map(|found| {
            let id = attribute(found.as_str(), "numFmtId")?.parse::<u64>().ok()?;
            let code = unescape_format(&attribute(found.as_str(), "formatCode")?);
            Some((id, code))
        })
        .collect();
    let body = cell_xfs
        .captures(styles)
        .and_then(|found| found.get(1))
        .map_or("", |m| m.as_str());
    xfs.find_iter(body)
        .map(|found| {
            let id = attribute(found.as_str(), "numFmtId")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let code = custom
                .iter()
                .find(|(custom_id, _)| *custom_id == id)
                .map(|(_, code)| code.as_str())
                .filter(|code| !code.is_empty());
            match code {
                Some(code) => is_date_format(code),
                None => matches!(id, 14..=22 | 45..=47),
            }
        })
        .collect()
}

/// A custom format code without the backslash escapes, as ExcelJS reads it.
fn unescape_format(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    let mut chars = code.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\'
            && let Some(next) = chars.next()
        {
            out.push(next);
        } else {
            out.push(ch);
        }
    }
    out
}

/// Whether a format code has date or time letters, once bracketed and quoted text is taken out. ExcelJS's rule.
fn is_date_format(code: &str) -> bool {
    static BRACKETS: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"\[[^\]]*\]").ok());
    static QUOTES: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r#""[^"]*""#).ok());
    let (Some(brackets), Some(quotes)) = (BRACKETS.as_ref(), QUOTES.as_ref()) else {
        return false;
    };
    let without_brackets = brackets.replace_all(code, "");
    let plain = quotes.replace_all(&without_brackets, "");
    plain.contains(['y', 'm', 'd', 'h', 'M', 's', 'b'])
}

/// The CSV lines of one sheet. A row counts only when one of its cells holds a value. Every column up to the last
/// cell in the row is kept, as the reference's cell walk does.
fn csv_rows(
    xml: &str,
    strings: &[String],
    date_styles: &[bool],
) -> Result<Vec<String>, OfficeError> {
    let (Some(rows), Some(cells)) = (ROW.as_ref(), CELL.as_ref()) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    for row in rows.captures_iter(xml) {
        let body = row.get(1).map_or("", |m| m.as_str());
        let mut values: Vec<(usize, Option<String>)> = Vec::new();
        for cell in cells.captures_iter(body) {
            let attributes = cell.get(1).map_or("", |m| m.as_str());
            let inner = cell.get(2).map_or("", |m| m.as_str());
            let style = attribute(attributes, "s").and_then(|style| style.parse::<usize>().ok());
            let read = cell_read(
                attributes,
                inner,
                strings,
                style
                    .and_then(|style| date_styles.get(style))
                    .copied()
                    .unwrap_or(false),
                style.is_some_and(|style| style != 0),
            )?;
            let text = match read {
                // A cell with no value and no style is not in the row at all.
                CellRead::Absent => continue,
                CellRead::Empty => None,
                CellRead::Text(text) => Some(text),
            };
            let column = match attribute(attributes, "r") {
                Some(reference) => column_index(&reference)?,
                None => values.len() + 1,
            };
            values.push((column, text));
        }
        if values.iter().all(|(_, text)| text.is_none()) {
            continue;
        }
        let width = values.iter().map(|(column, _)| *column).max().unwrap_or(0);
        let mut slots: Vec<Option<String>> = vec![None; width];
        for (column, text) in values {
            if let Some(slot) = slots.get_mut(column.saturating_sub(1)) {
                *slot = text;
            }
        }
        lines.push(
            slots
                .iter()
                .map(|slot| csv_cell(slot.as_deref().unwrap_or("")))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    Ok(lines)
}

/// What a `<c>` element holds: nothing at all (not in the row), a styled empty cell, or the text it shows.
enum CellRead {
    Absent,
    Empty,
    Text(String),
}

/// Reads one cell the way the reference's cell parser does: a value by its type, a formula by its cached result.
fn cell_read(
    attributes: &str,
    inner: &str,
    strings: &[String],
    date_style: bool,
    styled: bool,
) -> Result<CellRead, OfficeError> {
    let kind = attribute(attributes, "t").unwrap_or_default();
    if has_formula(inner) {
        let raw = value_of(inner).filter(|raw| !raw.is_empty());
        return Ok(CellRead::Text(formula_text(
            &kind,
            raw.as_deref(),
            date_style,
        )));
    }
    let value = if kind == "inlineStr" {
        inline_text(inner)
    } else {
        value_of(inner)
            .filter(|raw| !raw.is_empty())
            .map(|raw| typed_text(&kind, &raw, strings, date_style))
            .transpose()?
    };
    Ok(match value {
        Some(text) => CellRead::Text(text),
        None if styled => CellRead::Empty,
        None => CellRead::Absent,
    })
}

/// The text of a value cell, by its type. A shared string index with no entry is a failure in the reference.
fn typed_text(
    kind: &str,
    raw: &str,
    strings: &[String],
    date_style: bool,
) -> Result<String, OfficeError> {
    Ok(match kind {
        "s" => {
            let index = js_parse_int(raw);
            let found = (index >= 0.0 && index.fract() == 0.0)
                .then(|| strings.get(index as usize))
                .flatten();
            match found {
                Some(text) => text.clone(),
                None => return Err(OfficeError::SharedStringMissing),
            }
        }
        "str" => xml_decode_named(&decode_xml_entities(raw)),
        "b" => (if js_parse_int(raw) == 0.0 {
            "false"
        } else {
            "true"
        })
        .to_owned(),
        "e" => String::new(),
        _ => {
            let number = js_parse_float(raw);
            if date_style {
                excel_date_text(number)?
            } else {
                js_number_text(number)
            }
        }
    })
}

/// The text of a formula cell: its cached result, or nothing when it has none. A date style turns any result into a
/// date, and the reference then prints that Date with `String`, not as an ISO day.
fn formula_text(kind: &str, raw: Option<&str>, date_style: bool) -> String {
    let Some(raw) = raw else {
        return String::new();
    };
    let result = match kind {
        "str" => FormulaResult::Text(xml_decode_named(&decode_xml_entities(raw))),
        "b" => FormulaResult::Boolean(js_parse_int(raw) != 0.0),
        "e" => FormulaResult::Error,
        _ => FormulaResult::Number(js_parse_float(raw)),
    };
    if date_style {
        let serial = match &result {
            FormulaResult::Number(number) => *number,
            FormulaResult::Boolean(flag) => f64::from(u8::from(*flag)),
            FormulaResult::Text(text) => js_to_number(text),
            FormulaResult::Error => f64::NAN,
        };
        return js_date_string(excel_millis(serial));
    }
    match result {
        FormulaResult::Number(number) => js_number_text(number),
        FormulaResult::Boolean(flag) => flag.to_string(),
        FormulaResult::Text(text) => text,
        FormulaResult::Error => "[object Object]".to_owned(),
    }
}

/// A formula's cached result by its cell type.
enum FormulaResult {
    Number(f64),
    Boolean(bool),
    Text(String),
    Error,
}

fn has_formula(inner: &str) -> bool {
    static FORMULA: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<f(?:\s[^>]*)?/?>").ok());
    FORMULA.as_ref().is_some_and(|regex| regex.is_match(inner))
}

/// The raw text of a cell's value, still entity-encoded, so each reader decodes it once.
fn value_of(inner: &str) -> Option<String> {
    static VALUE: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<v(?:\s[^>]*)?>([^<]*)</v>|<v\s*/>").ok());
    let regex = VALUE.as_ref()?;
    let found = regex.captures(inner)?;
    Some(found.get(1).map_or("", |m| m.as_str()).to_owned())
}

/// The text of an inline string: every text element in the cell, joined. None when the cell has no text at all.
fn inline_text(inner: &str) -> Option<String> {
    static TEXT: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"<t(?:\s[^>]*)?>([\s\S]*?)</t>").ok());
    if !inner.contains("<is") {
        return None;
    }
    let regex = TEXT.as_ref()?;
    let joined: String = regex
        .captures_iter(inner)
        .map(|text| decode_xml_entities(text.get(1).map_or("", |m| m.as_str())))
        .collect();
    (!joined.is_empty()).then_some(joined)
}

/// Decodes the five named entities in one pass, as the reference's `xmlDecode` does. Numbers stay as they are.
fn xml_decode_named(text: &str) -> String {
    static NAMED: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"&[a-z]*;").ok());
    let Some(regex) = NAMED.as_ref() else {
        return text.to_owned();
    };
    regex
        .replace_all(text, |found: &regex::Captures| match &found[0] {
            "&lt;" => "<".to_owned(),
            "&gt;" => ">".to_owned(),
            "&amp;" => "&".to_owned(),
            "&apos;" => "'".to_owned(),
            "&quot;" => "\"".to_owned(),
            other => other.to_owned(),
        })
        .into_owned()
}

/// A cell reference's column as a number, A is 1 and AA is 27. Past the last column of a sheet the reference throws.
fn column_index(reference: &str) -> Result<usize, OfficeError> {
    let letters: String = reference
        .chars()
        .take_while(|ch| ch.is_ascii_uppercase())
        .collect();
    let column = letters.chars().fold(0usize, |n, ch| {
        n.saturating_mul(26)
            .saturating_add(ch as usize - 'A' as usize + 1)
    });
    if column > MAX_COLUMNS {
        return Err(OfficeError::ColumnOutOfBounds(letters));
    }
    Ok(column)
}

/// The number of columns in a worksheet.
const MAX_COLUMNS: usize = 16384;

/// The milliseconds a serial number stands for, as ExcelJS converts it. None when the date is not representable.
fn excel_millis(serial: f64) -> Option<f64> {
    let millis = js_round((serial - 25569.0) * 24.0 * 3600.0 * 1000.0);
    (millis.is_finite() && millis.abs() <= 8.64e15).then_some(millis)
}

/// A date cell's text, the UTC day of its serial number. A serial with no date is a failure in the reference.
fn excel_date_text(serial: f64) -> Result<String, OfficeError> {
    let millis = excel_millis(serial).ok_or(OfficeError::InvalidDate)?;
    let (year, month, day) = civil_from_days((millis / 86_400_000.0).floor() as i64);
    let iso = if (0..=9999).contains(&year) {
        format!("{year:04}-{month:02}-{day:02}")
    } else {
        let sign = if year < 0 { '-' } else { '+' };
        format!("{sign}{:06}-{month:02}-{day:02}", year.abs())
    };
    Ok(iso.chars().take(10).collect())
}

/// JavaScript's `String(date)` for a date in UTC, the zone the reference runs in here.
// TS quirk: the reference prints the whole Date, and its zone name depends on the machine. This port fixes it to UTC.
fn js_date_string(millis: Option<f64>) -> String {
    const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let Some(millis) = millis else {
        return "Invalid Date".to_owned();
    };
    let days = (millis / 86_400_000.0).floor() as i64;
    let in_day = (millis - days as f64 * 86_400_000.0) as i64;
    let (year, month, day) = civil_from_days(days);
    let weekday = WEEKDAYS[(days + 4).rem_euclid(7) as usize];
    format!(
        "{weekday} {} {day:02} {year:04} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        MONTHS[(month - 1) as usize],
        in_day / 3_600_000,
        (in_day / 60_000) % 60,
        (in_day / 1000) % 60,
    )
}

/// The civil date of a count of days since 1970-01-01, proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month as u32, day as u32)
}

/// JavaScript's `Math.round`: halves go up.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// JavaScript's `Number(text)` for a string: whitespace around a number is fine, anything else is NaN.
fn js_to_number(text: &str) -> f64 {
    static WHOLE: LazyLock<Option<Regex>> = LazyLock::new(|| {
        Regex::new(r"^[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$").ok()
    });
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    match WHOLE.as_ref() {
        Some(regex) if regex.is_match(trimmed) => trimmed.parse::<f64>().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

/// JavaScript's `parseFloat`: the longest number at the start of the text, or NaN.
fn js_parse_float(raw: &str) -> f64 {
    static NUMBER: LazyLock<Option<Regex>> = LazyLock::new(|| {
        compile(r"^[{S}]*([+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?))")
    });
    crate::js::captures(&NUMBER, raw)
        .and_then(|found| found.get(1))
        .and_then(|number| number.as_str().parse::<f64>().ok())
        .unwrap_or(f64::NAN)
}

/// JavaScript's `parseInt(text, 10)`: the whole number at the start of the text, or NaN.
fn js_parse_int(raw: &str) -> f64 {
    static INTEGER: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"^[{S}]*([+-]?[0-9]+)"));
    crate::js::captures(&INTEGER, raw)
        .and_then(|found| found.get(1))
        .and_then(|digits| digits.as_str().parse::<f64>().ok())
        .unwrap_or(f64::NAN)
}

/// A cell quoted for CSV when it holds a quote, a comma or a line break.
fn csv_cell(value: &str) -> String {
    if value.contains(['"', ',', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// A number as JavaScript's `String` writes it: no exponent in the common range, `e+` above and `e-` below.
pub(crate) fn js_number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let magnitude = value.abs();
    if (1e-6..1e21).contains(&magnitude) {
        return format!("{value}");
    }
    let formatted = format!("{value:e}");
    match formatted.split_once('e') {
        Some((mantissa, exponent)) if exponent.starts_with('-') => format!("{mantissa}e{exponent}"),
        Some((mantissa, exponent)) => format!("{mantissa}e+{exponent}"),
        None => formatted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_letters_count_from_a() {
        assert_eq!(column_index("A1").ok(), Some(1));
        assert_eq!(column_index("Z9").ok(), Some(26));
        assert_eq!(column_index("AA3").ok(), Some(27));
        assert_eq!(column_index("XFD1").ok(), Some(16384));
    }

    #[test]
    fn columns_past_the_sheet_limit_are_refused() {
        assert!(matches!(
            column_index("XFE1"),
            Err(OfficeError::ColumnOutOfBounds(letters)) if letters == "XFE"
        ));
        assert!(column_index("ZZZZZZZZZZZZZZZZZZZZ1").is_err());
    }

    #[test]
    fn excel_serials_read_as_utc_days() {
        assert_eq!(excel_date_text(46037.0).ok().as_deref(), Some("2026-01-15"));
        assert_eq!(excel_date_text(1.0).ok().as_deref(), Some("1899-12-31"));
        assert_eq!(excel_date_text(60.0).ok().as_deref(), Some("1900-02-28"));
        assert_eq!(excel_date_text(0.0).ok().as_deref(), Some("1899-12-30"));
        assert_eq!(
            excel_date_text(2958466.0).ok().as_deref(),
            Some("+010000-01")
        );
        assert!(excel_date_text(f64::NAN).is_err());
    }

    #[test]
    fn js_parse_float_reads_the_prefix() {
        assert_eq!(js_parse_float("2026-01-15T00:00:00Z"), 2026.0);
        assert!(js_parse_float("abc").is_nan());
        assert_eq!(js_parse_float("  -1.5e2x"), -150.0);
    }

    #[test]
    fn js_numbers_print_like_javascript() {
        assert_eq!(js_number_text(1200.0), "1200");
        assert_eq!(js_number_text(340.5), "340.5");
        assert_eq!(js_number_text(1e21), "1e+21");
        assert_eq!(js_number_text(1.5e-7), "1.5e-7");
        assert_eq!(js_number_text(-0.0), "0");
    }

    #[test]
    fn a_missing_slide_part_is_refused() {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("other.xml", options).expect("starts");
        std::io::Write::write_all(&mut zip, b"<x/>").expect("writes");
        let bytes = zip.finish().expect("finishes").into_inner();
        assert!(matches!(read_pptx(&bytes), Err(OfficeError::NoSlides)));
    }

    #[test]
    fn bytes_that_are_not_a_zip_are_refused() {
        assert!(matches!(
            read_docx(b"not a zip"),
            Err(OfficeError::NotAPackage)
        ));
    }
}
