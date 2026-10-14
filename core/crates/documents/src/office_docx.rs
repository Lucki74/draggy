//! Writes Markdown as a .docx with docx-rs. Ports markdownDocx in electron/documents.cjs: one paragraph per line,
//! heading styles, real list numbering, rules as bordered paragraphs and emoji in their own font.

use std::io::{Cursor, Read, Write};
use std::path::Path;

use docx_rs::{
    AbstractNumbering, BorderType, Docx, IndentLevel, Level, LevelJc, LevelText, LineSpacing,
    NumberFormat, Numbering, NumberingId, Paragraph, ParagraphBorder, ParagraphBorderPosition,
    ParagraphBorders, Run, RunFonts, SpecialIndentType, Start, Style, StyleType,
};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::html::is_html;
use crate::office_error::OfficeError;
use crate::office_markdown::{Block, classify, inline_runs};
use crate::office_style::{
    BODY_FONT, DefaultStyles, Spacing, StyleDef, docx_numbering, docx_styles,
};

/// The list definitions the writer adds. Ids 1 belongs to docx-rs's own list.
pub(crate) const BULLET_LIST: usize = 2;
pub(crate) const ORDERED_LIST: usize = 3;

/// What the writer reports back, as the reference does: the paragraphs it wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocxCounts {
    pub paragraphs: usize,
}

/// The package bytes for Markdown content, and the counts. HTML content is refused: it needs the HTML writer.
pub fn docx_bytes(content: &str) -> Result<(Vec<u8>, DocxCounts), OfficeError> {
    if is_html(Some(content)) {
        return Err(OfficeError::HtmlBody);
    }
    let paragraphs: Vec<Paragraph> = content.split('\n').map(paragraph_for_line).collect();
    let counts = DocxCounts {
        paragraphs: paragraphs.len(),
    };

    let mut docx = styled_document();
    for paragraph in paragraphs {
        docx = docx.add_paragraph(paragraph);
    }

    let mut buffer = Cursor::new(Vec::new());
    docx.pack(&mut buffer)
        .map_err(|error| build_error(error.to_string()))?;
    let bytes = with_body_colour(
        buffer.into_inner(),
        docx_styles().default.document.run.color,
    )?;
    Ok((bytes, counts))
}

pub(crate) fn build_error(message: String) -> OfficeError {
    OfficeError::Build {
        format: "docx",
        message,
    }
}

/// docx-rs writes its own Normal style with no colour, and has no setter for the colour of the document defaults.
/// The colour goes into that style, so body text is explicitly black as the reference's is.
pub(crate) fn with_body_colour(bytes: Vec<u8>, colour: &str) -> Result<Vec<u8>, OfficeError> {
    const NORMAL: &str =
        r#"<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:rPr />"#;
    let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice()))
        .map_err(|error| build_error(error.to_string()))?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut found = false;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| build_error(error.to_string()))?;
        let name = file
            .name()
            .map_err(|error| build_error(error.to_string()))?
            .into_owned();
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        if name == "word/styles.xml" {
            let xml = String::from_utf8_lossy(&data).into_owned();
            found = xml.contains(NORMAL);
            let patched = xml.replacen(
                NORMAL,
                &format!(r#"<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal" /><w:rPr><w:color w:val="{colour}" /></w:rPr>"#),
                1,
            );
            data = patched.into_bytes();
        }
        writer
            .start_file(name.as_str(), options)
            .map_err(|error| build_error(error.to_string()))?;
        writer.write_all(&data)?;
    }
    if !found {
        return Err(build_error(
            "docx-rs no longer writes its Normal style in the expected form".to_owned(),
        ));
    }
    let out = writer
        .finish()
        .map_err(|error| build_error(error.to_string()))?;
    Ok(out.into_inner())
}

/// Writes Markdown content to a .docx file at `path`.
pub fn write_docx(path: &Path, content: &str) -> Result<DocxCounts, OfficeError> {
    let (bytes, counts) = docx_bytes(content)?;
    std::fs::write(path, bytes)?;
    tracing::debug!(target: "files.documents", paragraphs = counts.paragraphs, "docx written");
    Ok(counts)
}

/// A document with the styles, numbering and defaults the reference writes.
pub(crate) fn styled_document() -> Docx {
    let defaults: DefaultStyles = docx_styles().default;
    let body = &defaults.document;

    let mut docx = Docx::new()
        .default_fonts(fonts(BODY_FONT))
        .default_size(half_points(body.run.size))
        .default_line_spacing(line_spacing(&body.paragraph.spacing));

    docx = docx.add_style(
        Style::new("ListParagraph", StyleType::Paragraph)
            .name("List Paragraph")
            .based_on("Normal")
            .q_format(true),
    );
    docx = docx.add_style(named_style("Title", "Title", &defaults.title));
    let headings = [
        &defaults.heading1,
        &defaults.heading2,
        &defaults.heading3,
        &defaults.heading4,
        &defaults.heading5,
        &defaults.heading6,
    ];
    for (index, def) in headings.into_iter().enumerate() {
        let level = index + 1;
        docx = docx.add_style(named_style(
            &format!("Heading{level}"),
            &format!("Heading {level}"),
            def,
        ));
    }

    let numbering = docx_numbering();
    let ordered = numbering
        .config
        .first()
        .and_then(|config| config.levels.first());
    let (format, text, left, hanging) = match ordered {
        Some(level) => (
            level.format,
            level.text,
            level.style.paragraph.indent.left,
            level.style.paragraph.indent.hanging,
        ),
        None => ("decimal", "%1.", 720.0, 360.0),
    };
    // docx-rs always writes its own list 1 first, so the lists here start at 2.
    docx = docx
        .add_abstract_numbering(list_level(BULLET_LIST, "bullet", "●", left, hanging))
        .add_numbering(Numbering::new(BULLET_LIST, BULLET_LIST))
        .add_abstract_numbering(list_level(ORDERED_LIST, format, text, left, hanging))
        .add_numbering(Numbering::new(ORDERED_LIST, ORDERED_LIST));
    docx
}

fn named_style(id: &str, name: &str, def: &StyleDef) -> Style {
    let run = &def.run;
    let mut style = Style::new(id, StyleType::Paragraph)
        .name(name)
        .based_on("Normal")
        .next("Normal")
        .q_format(true)
        .fonts(fonts(run.font))
        .size(half_points(run.size))
        .color(run.color)
        .line_spacing(line_spacing(&def.paragraph.spacing));
    if run.bold == Some(true) {
        style = style.bold();
    }
    style
}

/// One list level at indent 720 with a 360 hanging indent, as the reference lays lists out.
fn list_level(id: usize, format: &str, text: &str, left: f64, hanging: f64) -> AbstractNumbering {
    AbstractNumbering::new(id).add_level(
        Level::new(
            0,
            Start::new(1),
            NumberFormat::new(format),
            LevelText::new(text),
            // The numbered list is aligned to the start, as the reference's numbering says. Bullets keep the library's left.
            LevelJc::new(if format == "bullet" { "left" } else { "start" }),
        )
        .indent(
            Some(left as i32),
            Some(SpecialIndentType::Hanging(hanging as i32)),
            None,
            None,
        ),
    )
}

/// Points to docx's half points, which is what run sizes are stored in.
fn half_points(points: f64) -> usize {
    points as usize
}

pub(crate) fn fonts(name: &str) -> RunFonts {
    RunFonts::new()
        .ascii(name)
        .hi_ansi(name)
        .cs(name)
        .east_asia(name)
}

fn line_spacing(spacing: &Spacing) -> LineSpacing {
    let mut out = LineSpacing::new();
    if let Some(before) = spacing.before {
        out = out.before(before as u32);
    }
    if let Some(after) = spacing.after {
        out = out.after(after as u32);
    }
    if let Some(line) = spacing.line {
        out = out.line(line as i32);
    }
    out
}

/// The paragraph one line becomes. Blank lines keep an empty run, as the reference does.
fn paragraph_for_line(raw: &str) -> Paragraph {
    match classify(raw) {
        Block::Blank => Paragraph::new().add_run(Run::new().add_text("")),
        Block::Heading { level, text } => {
            with_runs(Paragraph::new().style(&format!("Heading{level}")), text)
        }
        Block::Rule => Paragraph::new().set_borders(rule_borders()),
        Block::Numbered(text) => with_runs(list_paragraph(ORDERED_LIST), text),
        Block::Bullet(text) => with_runs(list_paragraph(BULLET_LIST), text),
        Block::Text(text) => with_runs(Paragraph::new(), text),
    }
}

pub(crate) fn list_paragraph(id: usize) -> Paragraph {
    Paragraph::new()
        .style("ListParagraph")
        .numbering(NumberingId::new(id), IndentLevel::new(0))
}

/// A thin rule along the bottom edge of an empty paragraph, which is how Word draws a horizontal line.
pub(crate) fn rule_borders() -> ParagraphBorders {
    ParagraphBorders::with_empty().set(
        ParagraphBorder::new(ParagraphBorderPosition::Bottom)
            .val(BorderType::Single)
            .size(6)
            .space(1)
            .color("auto"),
    )
}

fn with_runs(mut paragraph: Paragraph, text: &str) -> Paragraph {
    for piece in inline_runs(text) {
        let mut run = Run::new().add_text(piece.text);
        if piece.bold {
            run = run.bold();
        }
        if piece.italic {
            run = run.italic();
        }
        if let Some(font) = piece.font {
            run = run.fonts(fonts(font));
        }
        paragraph = paragraph.add_run(run);
    }
    paragraph
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_paragraph_per_line_and_blank_lines_count() {
        let (_, counts) = docx_bytes("# Title\n\nFirst\n\nSecond").expect("writes");
        assert_eq!(counts, DocxCounts { paragraphs: 5 });
    }

    #[test]
    fn html_content_is_refused() {
        assert!(matches!(
            docx_bytes("<h1>Title</h1>"),
            Err(OfficeError::HtmlBody)
        ));
    }

    #[test]
    fn an_unwritable_path_is_a_write_error() {
        let path = std::env::temp_dir()
            .join("draggy-no-such-dir-docx")
            .join("x.docx");
        assert!(matches!(
            write_docx(&path, "hello"),
            Err(OfficeError::Write(_))
        ));
    }

    #[test]
    fn the_text_reads_back_without_markdown_syntax() {
        let (bytes, _) = docx_bytes(
            "# Title\n\nSome **bold** and *italic*.\n\n- first bullet\n\n1. first step\n\n---\n\nClosing line.",
        )
        .expect("writes");
        let text = crate::office_read::read_docx(&bytes).expect("reads");
        assert!(
            text.contains("Title")
                && text.contains("first bullet")
                && text.contains("Closing line.")
        );
        assert!(
            !text.contains("**bold**")
                && !text.contains("# Title")
                && !text.contains("1. first step")
        );
    }

    #[test]
    fn the_numbered_list_is_aligned_to_the_start_and_bullets_to_the_left() {
        let (bytes, _) = docx_bytes("1. first\n\n- bullet").expect("writes");
        let mut package = crate::office_zip::Package::open(&bytes).expect("opens");
        let numbering = package
            .text("word/numbering.xml")
            .expect("reads")
            .expect("has numbering");
        assert!(numbering.contains(r#"w:lvlJc w:val="start""#));
        assert!(numbering.contains(r#"w:lvlJc w:val="left""#));
    }
}
