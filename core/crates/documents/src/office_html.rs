//! Writes HTML as a .docx, .xlsx or .pptx. Ports the three writers in electron/htmlDocument.cjs: the walk over the
//! parsed HTML that decides which paragraphs, runs, tables, sheets and slides a document gets. Parsing and the CSS
//! readers are in html.rs.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;
use std::sync::LazyLock;

use docx_rs::{
    AlignmentType, BorderType, BreakType, Docx, IndentLevel, LineSpacing, NumberingId, Paragraph,
    ParagraphBorder, ParagraphBorderPosition, ParagraphBorders, Run, Shading, ShdType, Table,
    TableBorder, TableBorderPosition, TableBorders, TableCell, TableRow, WidthType,
};
use regex::Regex;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};

use crate::html::{
    Element, Node, Width, node_text, parse_color, parse_html, parse_pt, parse_width,
};
use crate::office_docx::{
    BULLET_LIST, ORDERED_LIST, build_error, fonts, rule_borders, styled_document, with_body_colour,
};
use crate::office_error::OfficeError;
use crate::office_markdown::{EMOJI, EMOJI_FONT};
use crate::office_pptx;
use crate::office_read::js_number_text;
use crate::office_style::{BODY_FONT, HEADING_FONT, MONO_FONT, SHEET_FONT, docx_styles, pt};
use crate::office_xml::escape_xml;

/// The fill of a header cell that the HTML does not colour itself.
const HEADER_FILL: &str = "F2F2F4";
/// The colour of the borders the writers draw.
const GRID_LINE: &str = "D0D0D8";
/// The colour a border gets when its style names none.
const DEFAULT_BORDER: &str = "3182CE";

static NUMERIC: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$").ok());
static HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"^h([1-6])$").ok());

/// The run formatting that a tag and its CSS hand down to the text inside it.
#[derive(Debug, Clone, Default)]
struct RunStyle {
    bold: bool,
    italics: bool,
    underline: bool,
    strike: bool,
    color: Option<String>,
    size: Option<f64>,
    font: Option<String>,
}

/// One block of a Word body: a paragraph, or a table.
enum Block {
    Paragraph(Box<Paragraph>),
    Table(Box<Table>),
}

/// The package bytes for an HTML document as a .docx, and how many blocks the body has.
pub fn docx_from_html(html: &str) -> Result<(Vec<u8>, usize), OfficeError> {
    let root = parse_html(html);
    let mut blocks = Vec::new();
    visit_block(&root, &mut blocks);
    if blocks.is_empty() {
        blocks.push(Block::Paragraph(Box::new(paragraph_with(Vec::new()))));
    }
    let count = blocks.len();

    let mut docx: Docx = styled_document();
    for block in blocks {
        docx = match block {
            Block::Paragraph(paragraph) => docx.add_paragraph(*paragraph),
            Block::Table(table) => docx.add_table(*table),
        };
    }
    let mut buffer = Cursor::new(Vec::new());
    docx.pack(&mut buffer)
        .map_err(|error| build_error(error.to_string()))?;
    let bytes = with_body_colour(
        buffer.into_inner(),
        docx_styles().default.document.run.color,
    )?;
    Ok((bytes, count))
}

/// Visits one node of the body. Wrappers pass through, and each block-level element becomes a paragraph or a table.
fn visit_block(node: &Node, blocks: &mut Vec<Block>) {
    let element = match node {
        Node::Root { children } => {
            for child in children {
                visit_block(child, blocks);
            }
            return;
        }
        Node::Element(element) => element,
        Node::Text { .. } => return,
    };
    if let Some(level) = heading_level(&element.tag) {
        let mut inherited = RunStyle {
            bold: true,
            ..RunStyle::default()
        };
        if let Some(color) = value(&element.style, "color").and_then(|raw| parse_color(Some(raw))) {
            inherited.color = Some(color);
        }
        if let Some(family) = value(&element.style, "font-family") {
            inherited.font = Some(first_font(family));
        }
        if let Some(size) = value(&element.style, "font-size") {
            inherited.size = Some(parse_pt(Some(size), 11.0));
        }
        let runs = collect_runs(node, &inherited);
        let paragraph = paragraph_with(runs).style(&format!("Heading{level}"));
        blocks.push(Block::Paragraph(Box::new(paragraph)));
        return;
    }

    // A div wrapping other blocks is a container, not a paragraph.
    if element.tag == "div" && has_block_child(element) {
        for child in &element.children {
            visit_block(child, blocks);
        }
        return;
    }

    match element.tag.as_str() {
        "p" | "div" => blocks.push(Block::Paragraph(Box::new(text_paragraph(node, element)))),
        "hr" => blocks.push(Block::Paragraph(Box::new(
            Paragraph::new().set_borders(rule_borders()),
        ))),
        "blockquote" => {
            let runs = collect_runs(
                node,
                &RunStyle {
                    italics: true,
                    ..RunStyle::default()
                },
            );
            let paragraph = paragraph_with(runs).indent(Some(720), None, None, None);
            blocks.push(Block::Paragraph(Box::new(paragraph)));
        }
        // Line breaks are the whole point of preformatted text, so each line is its own paragraph.
        "pre" => {
            let text = node_text(node);
            for line in text.trim_end_matches('\n').split('\n') {
                let run = Run::new()
                    .add_text(line)
                    .fonts(fonts(MONO_FONT))
                    .size(pt(9.5) as usize);
                let paragraph = Paragraph::new()
                    .line_spacing(LineSpacing::new().after(0).line(240))
                    .add_run(run);
                blocks.push(Block::Paragraph(Box::new(paragraph)));
            }
        }
        "ul" | "ol" => {
            let list = if element.tag == "ol" {
                ORDERED_LIST
            } else {
                BULLET_LIST
            };
            for child in &element.children {
                match child {
                    Node::Element(item) if item.tag == "li" => {
                        let runs = collect_runs(child, &RunStyle::default());
                        let paragraph = paragraph_with(runs)
                            .style("ListParagraph")
                            .numbering(NumberingId::new(list), IndentLevel::new(0));
                        blocks.push(Block::Paragraph(Box::new(paragraph)));
                    }
                    other => visit_block(other, blocks),
                }
            }
        }
        "table" => blocks.push(Block::Table(Box::new(table_for(node)))),
        _ => {
            for child in &element.children {
                visit_block(child, blocks);
            }
        }
    }
}

/// A `p` or `div` that holds text: its alignment, shading, left border and the runs it contains.
fn text_paragraph(node: &Node, element: &Element) -> Paragraph {
    let style = &element.style;
    let inherited = RunStyle {
        color: parse_color(value(style, "color")),
        font: value(style, "font-family").map(first_font),
        size: value(style, "font-size").map(|raw| parse_pt(Some(raw), 11.0)),
        ..RunStyle::default()
    };
    let mut paragraph = paragraph_with(collect_runs(node, &inherited));
    let align = value(style, "text-align").or_else(|| value(&element.attrs, "align"));
    paragraph = match align {
        Some("center") => paragraph.align(AlignmentType::Center),
        Some("right") => paragraph.align(AlignmentType::End),
        Some("justify") => paragraph.align(AlignmentType::Both),
        _ => paragraph,
    };
    let background = value(style, "background-color")
        .or_else(|| value(style, "background"))
        .and_then(|raw| parse_color(Some(raw)));
    if let Some(fill) = background {
        paragraph.property = paragraph.property.shading(solid_shading(&fill));
    }
    if let Some((color, size)) =
        parse_border(value(style, "border-left").or_else(|| value(style, "border")))
    {
        let left = ParagraphBorder::new(ParagraphBorderPosition::Left)
            .val(BorderType::Single)
            .size(size)
            .color(color);
        paragraph = paragraph.set_borders(ParagraphBorders::with_empty().set(left));
    }
    paragraph
}

/// A paragraph holding the runs, with an empty run when there are none.
fn paragraph_with(runs: Vec<Run>) -> Paragraph {
    let runs = if runs.is_empty() {
        vec![Run::new().add_text("")]
    } else {
        runs
    };
    runs.into_iter()
        .fold(Paragraph::new(), |paragraph, run| paragraph.add_run(run))
}

/// The text runs of a node and everything under it, each carrying the formatting its tags and CSS give it.
fn collect_runs(node: &Node, inherited: &RunStyle) -> Vec<Run> {
    let mut runs = Vec::new();
    push_runs(node, inherited, &mut runs);
    runs
}

fn push_runs(node: &Node, inherited: &RunStyle, runs: &mut Vec<Run>) {
    match node {
        Node::Text { text } => {
            if !text.is_empty() {
                push_text_runs(text, inherited, runs);
            }
        }
        Node::Element(element) => {
            if element.tag == "br" {
                runs.push(Run::new().add_break(BreakType::TextWrapping));
                return;
            }
            let current = element_style(element, inherited);
            for child in &element.children {
                push_runs(child, &current, runs);
            }
        }
        Node::Root { .. } => {}
    }
}

/// The formatting an element adds to what it inherits: its tag, its CSS and its colour attribute.
fn element_style(element: &Element, inherited: &RunStyle) -> RunStyle {
    let mut current = inherited.clone();
    match element.tag.as_str() {
        "strong" | "b" => current.bold = true,
        "em" | "i" => current.italics = true,
        "u" => current.underline = true,
        "s" | "del" | "strike" => current.strike = true,
        _ => {}
    }
    let style = &element.style;
    if value(style, "font-weight") == Some("bold")
        || parse_int(value(style, "font-weight")).is_some_and(|weight| weight >= 600)
    {
        current.bold = true;
    }
    if value(style, "font-style") == Some("italic") {
        current.italics = true;
    }
    if value(style, "text-decoration").is_some_and(|decoration| decoration.contains("underline")) {
        current.underline = true;
    }
    if value(style, "text-decoration").is_some_and(|decoration| decoration.contains("line-through"))
    {
        current.strike = true;
    }
    if let Some(color) =
        parse_color(value(style, "color").or_else(|| value(&element.attrs, "color")))
    {
        current.color = Some(color);
    }
    // Only when the HTML asks for a size, so a heading keeps its own.
    if let Some(size) = value(style, "font-size") {
        current.size = Some(parse_pt(Some(size), 11.0));
    }
    if let Some(family) = value(style, "font-family") {
        current.font = Some(first_font(family));
    }
    current
}

/// Text as runs, with each emoji in its own run in the emoji font. An emoji run keeps only the size.
fn push_text_runs(text: &str, style: &RunStyle, runs: &mut Vec<Run>) {
    let mut last = 0;
    if let Some(regex) = EMOJI.as_ref() {
        for found in regex.find_iter(text) {
            if found.start() > last {
                runs.push(styled_run(&text[last..found.start()], style));
            }
            let mut run = Run::new().add_text(found.as_str()).fonts(fonts(EMOJI_FONT));
            if let Some(size) = style.size {
                run = run.size(half_points(size));
            }
            runs.push(run);
            last = found.end();
        }
    }
    if last < text.len() {
        runs.push(styled_run(&text[last..], style));
    }
}

fn styled_run(text: &str, style: &RunStyle) -> Run {
    let mut run = Run::new().add_text(text);
    if style.bold {
        run = run.bold();
    }
    if style.italics {
        run = run.italic();
    }
    if style.underline {
        run = run.underline("single");
    }
    if style.strike {
        run = run.strike();
    }
    if let Some(color) = &style.color {
        run = run.color(color);
    }
    if let Some(size) = style.size {
        run = run.size(half_points(size));
    }
    if let Some(font) = &style.font {
        run = run.fonts(fonts(font));
    }
    run
}

/// Points as the half-points a run is measured in.
fn half_points(points: f64) -> usize {
    (points * 2.0).round() as usize
}

/// A table: its rows from every `tr` below it, with shaded headers and sized, aligned cells.
fn table_for(node: &Node) -> Table {
    let mut rows = Vec::new();
    for tr in find_rows(node) {
        let Node::Element(row) = tr else { continue };
        let mut cells = Vec::new();
        for cell_node in &row.children {
            let Node::Element(cell) = cell_node else {
                continue;
            };
            if cell.tag != "th" && cell.tag != "td" {
                continue;
            }
            let is_header = cell.tag == "th";
            let cell_style = &cell.style;
            let background = value(cell_style, "background-color")
                .or_else(|| value(cell_style, "background"))
                .or_else(|| value(&cell.attrs, "bgcolor"))
                .and_then(|raw| parse_color(Some(raw)));
            let runs = collect_runs(
                cell_node,
                &RunStyle {
                    bold: is_header,
                    size: Some(parse_pt(
                        value(cell_style, "font-size"),
                        if is_header { 11.0 } else { 10.0 },
                    )),
                    ..RunStyle::default()
                },
            );
            let mut paragraph = paragraph_with(runs);
            let align = value(cell_style, "text-align").or_else(|| value(&cell.attrs, "align"));
            paragraph = match align {
                Some("center") => paragraph.align(AlignmentType::Center),
                Some("right") => paragraph.align(AlignmentType::End),
                _ => paragraph,
            };
            let mut table_cell = TableCell::new().add_paragraph(paragraph);
            if let Some(fill) = background {
                table_cell = table_cell.shading(solid_shading(&fill));
            } else if is_header {
                table_cell = table_cell.shading(solid_shading(HEADER_FILL));
            }
            if let Some(Width::Px { value: width }) =
                parse_width(value(cell_style, "width").or_else(|| value(&cell.attrs, "width")))
            {
                table_cell = table_cell.width(twips(width), WidthType::Dxa);
            }
            cells.push(table_cell);
        }
        if !cells.is_empty() {
            rows.push(TableRow::new(cells));
        }
    }
    Table::new(rows)
        .width(5000, WidthType::Pct)
        .set_borders(grid_borders())
}

/// Every `tr` under a node, in document order, without looking inside a row.
fn find_rows(node: &Node) -> Vec<&Node> {
    match node {
        Node::Element(element) if element.tag == "tr" => vec![node],
        Node::Element(element) => element.children.iter().flat_map(find_rows).collect(),
        _ => Vec::new(),
    }
}

/// Thin grey lines on every edge of a table.
fn grid_borders() -> TableBorders {
    let line = |position| {
        TableBorder::new(position)
            .size(4)
            .color(GRID_LINE)
            .border_type(BorderType::Single)
    };
    TableBorders::new()
        .set(line(TableBorderPosition::Top))
        .set(line(TableBorderPosition::Bottom))
        .set(line(TableBorderPosition::Left))
        .set(line(TableBorderPosition::Right))
        .set(line(TableBorderPosition::InsideH))
        .set(line(TableBorderPosition::InsideV))
}

fn solid_shading(fill: &str) -> Shading {
    Shading::new().shd_type(ShdType::Clear).fill(fill)
}

/// CSS pixels as the twentieths of a point a Word cell is measured in.
fn twips(pixels: f64) -> usize {
    (pixels * 15.0).round() as usize
}

fn heading_level(tag: &str) -> Option<usize> {
    let captures = HEADING.as_ref()?.captures(tag)?;
    captures.get(1)?.as_str().parse().ok()
}

/// Whether a wrapper holds any element that carries its own block of the document.
fn has_block_child(element: &Element) -> bool {
    element.children.iter().any(|child| match child {
        Node::Element(child) => BLOCK_TAGS.contains(&child.tag.as_str()),
        _ => false,
    })
}

/// Tags that carry their own block. A wrapper holding one of them is scaffolding, not a paragraph.
const BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "dl",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];

/// A non-empty CSS or attribute value, which is how JavaScript's `||` treats it.
fn value<'a>(map: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    map.get(key)
        .map(String::as_str)
        .filter(|raw| !raw.is_empty())
}

/// The first font of a font list, without its quotes.
fn first_font(list: &str) -> String {
    list.split(',')
        .next()
        .unwrap_or("")
        .replace(['\'', '"'], "")
        .trim()
        .to_owned()
}

/// The integer at the start of a value, as `parseInt(value, 10)` reads it.
fn parse_int(raw: Option<&str>) -> Option<i64> {
    let trimmed = raw?.trim_start();
    let (sign, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    let end = digits
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(digits.len());
    digits[..end]
        .parse::<i64>()
        .ok()
        .map(|number| sign * number)
}

/// A border's colour and width in eighths of a point. Its style names a width in pixels or points.
fn parse_border(raw: Option<&str>) -> Option<(String, usize)> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut color = None;
    let mut size = 4;
    for part in trimmed.split_whitespace() {
        if let Some(found) = parse_color(Some(part)) {
            color = Some(found);
        }
        if let Some(width) = parse_int(Some(part)).filter(|width| *width > 0) {
            size = width.saturating_mul(8).clamp(1, 4096) as usize;
        }
    }
    Some((color.unwrap_or_else(|| DEFAULT_BORDER.to_owned()), size))
}

/// The package bytes for an HTML document as a workbook, one sheet per table, and how many sheets it has.
pub fn xlsx_from_html(html: &str) -> Result<(Vec<u8>, usize), OfficeError> {
    let root = parse_html(html);
    let mut tables = Vec::new();
    find_tables(&root, &mut tables);
    // With no table the reference still writes one empty sheet, so there is always at least one.
    let sheets: Vec<Option<&Node>> = if tables.is_empty() {
        vec![None]
    } else {
        tables.into_iter().map(Some).collect()
    };
    let count = sheets.len();

    let mut workbook = Workbook::new();
    let mut default_index = 1;
    for table in sheets {
        let named = table.and_then(|node| match node {
            Node::Element(element) => value(&element.attrs, "data-sheet")
                .or_else(|| value(&element.attrs, "id"))
                .map(str::to_owned),
            _ => None,
        });
        let name = named.unwrap_or_else(|| {
            let generated = format!("Sheet{default_index}");
            default_index += 1;
            generated
        });
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(name.chars().take(31).collect::<String>())
            .map_err(xlsx_error)?;
        write_table_sheet(worksheet, table.map_or_else(Vec::new, find_rows)).map_err(xlsx_error)?;
    }
    let bytes = workbook.save_to_buffer().map_err(xlsx_error)?;
    Ok((bytes, count))
}

fn xlsx_error(error: rust_xlsxwriter::XlsxError) -> OfficeError {
    OfficeError::Build {
        format: "xlsx",
        message: error.to_string(),
    }
}

/// Every table under a node, in document order.
fn find_tables<'a>(node: &'a Node, out: &mut Vec<&'a Node>) {
    match node {
        Node::Element(element) if element.tag == "table" => out.push(node),
        Node::Element(element) => {
            for child in &element.children {
                find_tables(child, out);
            }
        }
        Node::Root { children } => {
            for child in children {
                find_tables(child, out);
            }
        }
        Node::Text { .. } => {}
    }
}

/// Writes the rows of one table onto a sheet: values, fonts, fills, borders, merged spans and column widths.
fn write_table_sheet(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    rows: Vec<&Node>,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    let mut occupied: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut max_lengths: BTreeMap<usize, usize> = BTreeMap::new();
    let mut explicit_widths: BTreeMap<usize, usize> = BTreeMap::new();

    for (row_index, tr) in rows.into_iter().enumerate() {
        let row = row_index + 1;
        let Node::Element(row_element) = tr else {
            continue;
        };
        let mut column = 1;
        for cell_node in &row_element.children {
            let Node::Element(cell) = cell_node else {
                continue;
            };
            if cell.tag != "th" && cell.tag != "td" {
                continue;
            }
            while occupied.contains(&(row, column)) {
                column += 1;
            }
            let is_header = cell.tag == "th";
            let colspan = span(cell.attrs.get("colspan"));
            let rowspan = span(cell.attrs.get("rowspan"));
            let cell_style = &cell.style;

            let raw_text = node_text(cell_node).trim().to_owned();
            let numeric = NUMERIC
                .as_ref()
                .is_some_and(|regex| regex.is_match(&raw_text))
                .then(|| raw_text.parse::<f64>().ok())
                .flatten()
                .filter(|number| number.is_finite());

            let mut font_format = Format::new()
                .set_font_name(
                    value(cell_style, "font-family")
                        .map(first_font)
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| SHEET_FONT.to_owned()),
                )
                .set_font_size(parse_pt(
                    value(cell_style, "font-size"),
                    if is_header { 11.0 } else { 10.0 },
                ))
                .set_text_wrap()
                .set_border(FormatBorder::Thin)
                .set_border_color(Color::RGB(hex(GRID_LINE)));
            let weight = parse_int(value(cell_style, "font-weight"));
            if is_header
                || value(cell_style, "font-weight") == Some("bold")
                || weight.is_some_and(|w| w >= 600)
            {
                font_format = font_format.set_bold();
            }
            if value(cell_style, "font-style") == Some("italic") {
                font_format = font_format.set_italic();
            }
            if let Some(color) =
                parse_color(value(cell_style, "color").or_else(|| value(&cell.attrs, "color")))
            {
                font_format = font_format.set_font_color(Color::RGB(hex(&color)));
            }
            let background = value(cell_style, "background-color")
                .or_else(|| value(cell_style, "background"))
                .or_else(|| value(&cell.attrs, "bgcolor"))
                .and_then(|raw| parse_color(Some(raw)));
            if let Some(fill) = background {
                font_format = font_format.set_background_color(Color::RGB(hex(&fill)));
            } else if is_header {
                font_format = font_format.set_background_color(Color::RGB(hex(HEADER_FILL)));
            }
            let align = value(cell_style, "text-align").or_else(|| value(&cell.attrs, "align"));
            font_format = match align {
                Some("center") => font_format.set_align(FormatAlign::Center),
                Some("right") => font_format.set_align(FormatAlign::Right),
                _ if numeric.is_some() => font_format.set_align(FormatAlign::Right),
                _ => font_format.set_align(FormatAlign::Left),
            };
            font_format = font_format.set_align(FormatAlign::VerticalCenter);

            let (row0, column0) = ((row - 1) as u32, (column - 1) as u16);
            let text_length = match numeric {
                Some(number) => js_number_text(number).encode_utf16().count(),
                None => raw_text.encode_utf16().count(),
            };
            let entry = max_lengths.entry(column).or_insert(0);
            *entry = (*entry).max(text_length);
            if let Some(Width::Px { value: width }) =
                parse_width(value(cell_style, "width").or_else(|| value(&cell.attrs, "width")))
            {
                let entry = explicit_widths.entry(column).or_insert(0);
                *entry = (*entry).max((width / 7.0 + 0.5).floor() as usize);
            }

            if colspan > 1 || rowspan > 1 {
                for row_offset in 0..rowspan {
                    for column_offset in 0..colspan {
                        occupied.insert((row + row_offset, column + column_offset));
                    }
                }
                worksheet.merge_range(
                    row0,
                    column0,
                    row0 + (rowspan - 1) as u32,
                    column0 + (colspan - 1) as u16,
                    "",
                    &font_format,
                )?;
            }
            match numeric {
                Some(number) => {
                    worksheet.write_number_with_format(row0, column0, number, &font_format)?;
                }
                None => {
                    worksheet.write_string_with_format(row0, column0, &raw_text, &font_format)?;
                }
            }
            column += colspan;
        }
    }

    let max_column = max_lengths.keys().copied().max().unwrap_or(0).max(1);
    for column in 1..=max_column {
        let auto = 12.max(50.min(max_lengths.get(&column).copied().unwrap_or(0) + 3));
        let width = explicit_widths
            .get(&column)
            .copied()
            .filter(|width| *width > 0)
            .unwrap_or(auto);
        worksheet.set_column_width((column - 1) as u16, width as f64)?;
    }
    Ok(())
}

/// A span attribute as the reference reads it: a number, or one when it is missing or not a number.
fn span(raw: Option<&String>) -> usize {
    match parse_int(raw.map(String::as_str)) {
        Some(number) if number > 0 => number as usize,
        _ => 1,
    }
}

/// A hex colour such as `D0D0D8` as the number the writer takes.
fn hex(colour: &str) -> u32 {
    u32::from_str_radix(colour, 16).unwrap_or(0)
}

/// The package bytes for an HTML document as a deck, one slide per section, and how many slides it has.
pub fn pptx_from_html(html: &str) -> Result<(Vec<u8>, usize), OfficeError> {
    let root = parse_html(html);
    let blocks = slide_blocks(&root);
    let slides: Vec<String> = blocks.iter().map(slide_xml).collect();
    let count = slides.len();
    let bytes = office_pptx::package(&slides)?;
    Ok((bytes, count))
}

/// The slide sections of a document: elements marked as slides, else groups of the top level split at each `h1` or
/// rule, else the whole document.
fn slide_blocks(root: &Node) -> Vec<Node> {
    let mut marked = Vec::new();
    find_slide_blocks(root, &mut marked);
    if !marked.is_empty() {
        return marked;
    }
    let Node::Root { children } = root else {
        return vec![root.clone()];
    };
    let mut groups: Vec<Vec<Node>> = Vec::new();
    let mut current: Vec<Node> = Vec::new();
    for child in children {
        match child {
            Node::Element(element) if element.tag == "h1" || element.tag == "hr" => {
                if !current.is_empty() {
                    groups.push(std::mem::take(&mut current));
                }
                if element.tag == "h1" {
                    current.push(child.clone());
                }
            }
            other => current.push(other.clone()),
        }
    }
    if !current.is_empty() {
        groups.push(current);
    }
    if groups.is_empty() {
        return vec![root.clone()];
    }
    groups
        .into_iter()
        .map(|children| {
            Node::Element(Element {
                tag: "section".to_owned(),
                attrs: BTreeMap::new(),
                style: BTreeMap::new(),
                children,
            })
        })
        .collect()
}

/// Every element marked as a slide, without looking inside one.
fn find_slide_blocks(node: &Node, out: &mut Vec<Node>) {
    if let Node::Root { children } = node {
        for child in children {
            find_slide_blocks(child, out);
        }
        return;
    }
    let Node::Element(element) = node else { return };
    let marked = element.tag == "section"
        || value(&element.attrs, "class").is_some_and(|class| class.contains("slide"))
        || value(&element.attrs, "data-slide").is_some();
    if marked {
        out.push(node.clone());
        return;
    }
    for child in &element.children {
        find_slide_blocks(child, out);
    }
}

/// The formatting of one piece of slide text.
#[derive(Debug, Clone)]
struct TextStyle {
    color: String,
    font: String,
    size: f64,
    bold: bool,
    italic: bool,
}

/// One paragraph of a text box: the style it starts with, and its runs.
struct TextParagraph {
    style: TextStyle,
    runs: Vec<(String, TextStyle)>,
}

/// A table on a slide, as its rows of cells.
struct TableSpec {
    rows: Vec<Vec<CellSpec>>,
}

struct CellSpec {
    text: String,
    bold: bool,
    color: String,
    fill: Option<String>,
    size: f64,
}

/// What a slide holds while its body is walked.
struct SlideBuilder {
    y: f64,
    shapes: Vec<String>,
    body: Vec<(String, TextStyle)>,
}

const SLIDE_HEADING: &str = "111111";
const SLIDE_TEXT: &str = "333333";
const SLIDE_TABLE_TEXT: &str = "222222";
const SLIDE_TABLE_HEADER: &str = "F2F2F4";

/// The XML of one slide: its background, its title, the tables in document order, and the body text last.
fn slide_xml(block: &Node) -> String {
    let empty = BTreeMap::new();
    let (style, attrs) = match block {
        Node::Element(element) => (&element.style, &element.attrs),
        _ => (&empty, &empty),
    };
    let background = value(style, "background-color")
        .or_else(|| value(style, "background"))
        .or_else(|| value(attrs, "data-background"))
        .and_then(|raw| parse_color(Some(raw)));

    let mut slide = SlideBuilder {
        y: 0.5,
        shapes: Vec::new(),
        body: Vec::new(),
    };
    let title = find_title(block);
    if let Some(title_node) = title {
        let (title_style, title_attrs) = match title_node {
            Node::Element(element) => (&element.style, &element.attrs),
            _ => (&empty, &empty),
        };
        let text = node_text(title_node).trim().to_owned();
        let color =
            parse_color(value(title_style, "color").or_else(|| value(title_attrs, "color")))
                .unwrap_or_else(|| SLIDE_HEADING.to_owned());
        let title_text = TextStyle {
            color,
            font: HEADING_FONT.to_owned(),
            size: parse_pt(value(title_style, "font-size"), 26.0),
            bold: true,
            italic: false,
        };
        slide.text_box(
            0.6,
            0.5,
            8.8,
            0.8,
            &title_text,
            &[(text, title_text.clone())],
        );
        slide.y += 1.0;
    }
    walk_body(block, title, &mut slide);
    if !slide.body.is_empty() {
        let height = (6.5 - slide.y).max(1.5);
        let body = std::mem::take(&mut slide.body);
        let y = slide.y;
        let first = body[0].1.clone();
        slide.text_box(0.6, y, 8.8, height, &first, &body);
    }

    let background_xml = background
        .map(|fill| {
            format!(
                r#"<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>"#
            )
        })
        .unwrap_or_default();
    let shapes: String = slide.shapes.concat();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld {NS}><p:cSld>{background_xml}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
        NS = office_pptx::NS,
    )
}

/// The first heading of level one or two in a block, searching the block itself first.
fn find_title(node: &Node) -> Option<&Node> {
    let Node::Element(element) = node else {
        return None;
    };
    if element.tag == "h1" || element.tag == "h2" {
        return Some(node);
    }
    element.children.iter().find_map(find_title)
}

/// Collects the body of a slide in document order: paragraphs and list items as text, tables as their own frames.
fn walk_body(item: &Node, title: Option<&Node>, slide: &mut SlideBuilder) {
    if title.is_some_and(|title_node| std::ptr::eq(title_node, item)) {
        return;
    }
    let Node::Element(element) = item else { return };
    let subheading = heading_level(&element.tag).is_some();
    if subheading || element.tag == "p" || element.tag == "li" {
        let is_bullet = element.tag == "li";
        let style = &element.style;
        let text = node_text(item).trim().to_owned();
        if !text.is_empty() {
            let formatted = TextStyle {
                color: parse_color(value(style, "color")).unwrap_or_else(|| {
                    if subheading {
                        SLIDE_HEADING
                    } else {
                        SLIDE_TEXT
                    }
                    .to_owned()
                }),
                font: value(style, "font-family")
                    .map(first_font)
                    .filter(|family| !family.is_empty())
                    .unwrap_or_else(|| BODY_FONT.to_owned()),
                size: parse_pt(
                    value(style, "font-size"),
                    if subheading { 18.0 } else { 16.0 },
                ),
                bold: subheading || value(style, "font-weight") == Some("bold"),
                italic: value(style, "font-style") == Some("italic"),
            };
            let line = if is_bullet {
                format!("• {text}\n")
            } else {
                format!("{text}\n\n")
            };
            slide.body.push((line, formatted));
        }
        return;
    }
    if element.tag == "table" {
        let table = table_spec(element);
        if !table.rows.is_empty() {
            let rows = table.rows.len();
            slide.table(0.6, slide.y, 8.8, &table);
            slide.y += rows as f64 * 0.4 + 0.5;
        }
        return;
    }
    for child in &element.children {
        walk_body(child, title, slide);
    }
}

/// The rows of a table as slide cells. Rows may sit directly under the table or one level down, as in `thead`.
fn table_spec(table: &Element) -> TableSpec {
    let mut rows = Vec::new();
    for child in &table.children {
        let Node::Element(child_element) = child else {
            continue;
        };
        let row_nodes: Vec<&Node> = if child_element.tag == "tr" {
            vec![child]
        } else {
            child_element
                .children
                .iter()
                .filter(|grand| matches!(grand, Node::Element(row) if row.tag == "tr"))
                .collect()
        };
        for row_node in row_nodes {
            let Node::Element(row) = row_node else {
                continue;
            };
            let mut cells = Vec::new();
            for cell_node in &row.children {
                let Node::Element(cell) = cell_node else {
                    continue;
                };
                if cell.tag != "th" && cell.tag != "td" {
                    continue;
                }
                let is_header = cell.tag == "th";
                let style = &cell.style;
                cells.push(CellSpec {
                    text: node_text(cell_node).trim().to_owned(),
                    bold: is_header || value(style, "font-weight") == Some("bold"),
                    color: parse_color(value(style, "color"))
                        .unwrap_or_else(|| SLIDE_TABLE_TEXT.to_owned()),
                    fill: parse_color(
                        value(style, "background-color").or_else(|| value(style, "background")),
                    )
                    .or_else(|| is_header.then(|| SLIDE_TABLE_HEADER.to_owned())),
                    size: parse_pt(
                        value(style, "font-size"),
                        if is_header { 12.0 } else { 11.0 },
                    ),
                });
            }
            if !cells.is_empty() {
                rows.push(cells);
            }
        }
    }
    TableSpec { rows }
}

impl SlideBuilder {
    /// A text box with the given paragraphs. Each piece of text keeps its own formatting.
    fn text_box(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        fallback: &TextStyle,
        pieces: &[(String, TextStyle)],
    ) {
        let paragraphs = split_paragraphs(fallback, pieces);
        let body: String = paragraphs.iter().map(paragraph_xml).collect();
        let id = self.shapes.len() + 2;
        self.shapes.push(format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Text {id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/>{body}</p:txBody></p:sp>"#,
            x = office_pptx::emu(x),
            y = office_pptx::emu(y),
            cx = office_pptx::emu(width),
            cy = office_pptx::emu(height),
        ));
    }

    /// A table frame at the given place, with its columns sharing the width and rows of 0.4 inch.
    fn table(&mut self, x: f64, y: f64, width: f64, table: &TableSpec) {
        let columns = table.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let column_width = width / columns as f64;
        let grid: String = (0..columns)
            .map(|_| format!(r#"<a:gridCol w="{}"/>"#, office_pptx::emu(column_width)))
            .collect();
        let rows: String = table
            .rows
            .iter()
            .map(|row| {
                let cells: String = row
                    .iter()
                    .map(|cell| {
                        let style = TextStyle {
                            color: cell.color.clone(),
                            font: BODY_FONT.to_owned(),
                            size: cell.size,
                            bold: cell.bold,
                            italic: false,
                        };
                        let paragraph = if cell.text.is_empty() {
                            TextParagraph { style: style.clone(), runs: Vec::new() }
                        } else {
                            TextParagraph { style: style.clone(), runs: vec![(cell.text.clone(), style)] }
                        };
                        let fill = cell
                            .fill
                            .as_ref()
                            .map(|fill| format!(r#"<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>"#))
                            .unwrap_or_default();
                        format!(
                            r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{paragraph}</a:txBody><a:tcPr>{fill}</a:tcPr></a:tc>"#,
                            paragraph = paragraph_xml(&paragraph),
                        )
                    })
                    .collect();
                format!(r#"<a:tr h="{}">{cells}</a:tr>"#, office_pptx::emu(0.4))
            })
            .collect();
        let id = self.shapes.len() + 2;
        let height = table.rows.len() as f64 * 0.4;
        self.shapes.push(format!(
            r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{id}" name="Table {id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#,
            x = office_pptx::emu(x),
            y = office_pptx::emu(y),
            cx = office_pptx::emu(width),
            cy = office_pptx::emu(height),
        ));
    }
}

/// The paragraph of a text box. The reference keeps every run in one paragraph and writes each line break inside a
/// run as CRLF, so a break does not start a new paragraph.
fn split_paragraphs(fallback: &TextStyle, pieces: &[(String, TextStyle)]) -> Vec<TextParagraph> {
    let style = pieces
        .first()
        .map_or_else(|| fallback.clone(), |(_, style)| style.clone());
    let runs = pieces
        .iter()
        .filter(|(text, _)| !text.is_empty())
        .map(|(text, style)| (text.replace('\n', "\r\n"), style.clone()))
        .collect();
    vec![TextParagraph { style, runs }]
}

/// A paragraph as DrawingML: its runs, or only its end mark when it is empty.
fn paragraph_xml(paragraph: &TextParagraph) -> String {
    if paragraph.runs.is_empty() {
        return format!(
            r#"<a:p><a:endParaRPr lang="en-US" sz="{}"/></a:p>"#,
            (paragraph.style.size * 100.0).round() as i64
        );
    }
    let runs: String = paragraph
        .runs
        .iter()
        .map(|(text, style)| {
            let bold = if style.bold { r#" b="1""# } else { "" };
            let italic = if style.italic { r#" i="1""# } else { "" };
            format!(
                r#"<a:r><a:rPr lang="en-US" sz="{size}"{bold}{italic}><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="{font}"/></a:rPr><a:t>{text}</a:t></a:r>"#,
                size = (style.size * 100.0).round() as i64,
                color = style.color,
                font = escape_xml(&style.font),
                text = escape_xml(text),
            )
        })
        .collect();
    format!("<a:p>{runs}</a:p>")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::office_read::{read_docx, read_pptx, read_xlsx};
    use crate::office_zip::Package;

    fn part(bytes: &[u8], name: &str) -> String {
        let mut package = Package::open(bytes).expect("opens");
        package.text(name).expect("reads").expect("has the part")
    }

    #[test]
    fn a_part_that_inflates_past_the_cap_is_refused_not_read() {
        let (bytes, _) =
            docx_from_html(&format!("<p>{}</p>", "a".repeat(2_000_000))).expect("writes");
        assert!(matches!(read_docx(&bytes), Err(OfficeError::Corrupt(_))));
    }

    #[test]
    fn thousands_of_nested_elements_convert_without_overflowing_the_stack() {
        let html = format!(
            "{}<p>deep</p>{}",
            "<div>".repeat(5_000),
            "</div>".repeat(5_000)
        );
        let (bytes, _) = docx_from_html(&html).expect("writes");
        assert!(read_docx(&bytes).is_ok());
        let spans = format!("{}deep", "<span>".repeat(5_000));
        assert!(docx_from_html(&spans).is_ok());
    }

    #[test]
    fn heading_and_run_colours_reach_the_document() {
        let (bytes, _) = docx_from_html(
            r#"<h1 style="color: #FF0000;">Styled Document</h1><p>A <strong style="color: #008000;">green bold</strong> line.</p><table><tr><th>H</th></tr><tr><td>V</td></tr></table>"#,
        )
        .expect("writes");
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"w:color w:val="FF0000""#));
        assert!(xml.contains(r#"w:color w:val="008000""#));
        assert!(xml.contains("w:tbl"));
        let text = read_docx(&bytes).expect("reads back");
        assert!(text.contains("green bold"));
        assert!(text.contains('V'));
    }

    #[test]
    fn a_heading_keeps_its_size_and_a_size_the_html_asks_for_is_kept() {
        let (plain, _) = docx_from_html("<h1>Big</h1><p>Small</p>").expect("writes");
        assert!(!part(&plain, "word/document.xml").contains(r#"w:sz w:val="22""#));
        let (sized, _) = docx_from_html(r#"<p style="font-size: 18pt">Large</p>"#).expect("writes");
        assert!(part(&sized, "word/document.xml").contains(r#"w:sz w:val="36""#));
    }

    #[test]
    fn the_default_typeface_is_aptos() {
        let (bytes, _) = docx_from_html("<p>Plain</p>").expect("writes");
        assert!(part(&bytes, "word/styles.xml").contains("Aptos"));
    }

    #[test]
    fn preformatted_lines_stay_separate_paragraphs() {
        let (bytes, blocks) = docx_from_html("<pre>first\nsecond\nthird</pre>").expect("writes");
        assert_eq!(blocks, 3);
        let text = read_docx(&bytes).expect("reads back");
        assert!(text.find("first") < text.find("second"));
    }

    #[test]
    fn a_wrapping_div_keeps_its_headings_lists_and_tables() {
        let (bytes, _) = docx_from_html(
            "<div class=\"page\"><h1>Report</h1><p>Opening.</p><ul><li>One</li></ul><table><tr><td>Cell</td></tr></table></div>",
        )
        .expect("writes");
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"w:pStyle w:val="Heading1""#));
        assert!(xml.contains("w:tbl"));
        assert!(xml.contains("w:numPr") || xml.contains("w:numId"));
    }

    #[test]
    fn a_workbook_from_a_table_reads_back_its_cells() {
        let (bytes, sheets) = xlsx_from_html(
            r#"<table><tr><th style="width: 150px; background-color: #4f46e5;">Name</th><th>Score</th></tr><tr><td>Ada Lovelace</td><td>98.5</td></tr></table>"#,
        )
        .expect("writes");
        assert_eq!(sheets, 1);
        let text = read_xlsx(&bytes).expect("reads back");
        assert!(text.contains("Ada Lovelace,98.5"));
    }

    #[test]
    fn a_deck_from_sections_reads_back_its_titles_and_bullets() {
        let (bytes, slides) = pptx_from_html(
            r#"<section style="background-color: #f0f0f0;"><h2 style="color: #000080;">Introduction Slide</h2><p>Key takeaway</p><ul><li>First bullet point</li></ul></section><section><h2>Data Slide</h2><p>Summary</p></section>"#,
        )
        .expect("writes");
        assert_eq!(slides, 2);
        let text = read_pptx(&bytes).expect("reads back");
        assert!(text.contains("Introduction Slide"));
        assert!(text.contains("• First bullet point"));
        assert!(text.contains("Data Slide"));
    }

    #[test]
    fn a_document_without_tables_still_gets_one_sheet() {
        let (_, sheets) = xlsx_from_html("<p>no tables here</p>").expect("writes");
        assert_eq!(sheets, 1);
    }

    #[test]
    fn spans_are_read_as_numbers_and_default_to_one() {
        assert_eq!(span(None), 1);
        assert_eq!(span(Some(&"3".to_owned())), 3);
        assert_eq!(span(Some(&"0".to_owned())), 1);
        assert_eq!(span(Some(&"x".to_owned())), 1);
    }

    #[test]
    fn borders_read_their_colour_and_width() {
        assert_eq!(
            parse_border(Some("3px solid #FF0000")),
            Some(("FF0000".to_owned(), 24))
        );
        assert_eq!(
            parse_border(Some("solid")),
            Some((DEFAULT_BORDER.to_owned(), 4))
        );
        assert_eq!(parse_border(Some("  ")), None);
    }
}
